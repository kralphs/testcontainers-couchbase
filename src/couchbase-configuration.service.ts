/* eslint-disable @typescript-eslint/no-empty-function */
import { default as axios, AxiosInstance, AxiosResponse } from 'axios';
import { StartedTestContainer } from 'testcontainers';
import { BucketDefinition } from './bucket-definition.js';
import { CollectionDefinition } from './collection-definition.js';
import { CouchbaseService } from './couchbase-service.js';
import { log } from './logger.js';
import { IntervalRetryStrategy } from './retry-strategy.js';
import { ScopeDefinition } from './scope-definition.js';

interface CouchbasePorts {
    MGMT_PORT: number;
    MGMT_SSL_PORT: number;
    VIEW_PORT: number;
    VIEW_SSL_PORT: number;
    QUERY_PORT: number;
    QUERY_SSL_PORT: number;
    SEARCH_PORT: number;
    SEARCH_SSL_PORT: number;
    ANALYTICS_PORT: number;
    ANALYTICS_SSL_PORT: number;
    EVENTING_PORT: number;
    EVENTING_SSL_PORT: number;
    KV_PORT: number;
    KV_SSL_PORT: number;
}

/**
 * TypeScript won't let us access private properties of CouchbaseContainer;
 * so this is a more type safe way than using any or publicizing CouchbaseContainer's API
 */
export type CouchbaseContainerFacade = {
    username: string;
    userPassword: string;
    buckets: Map<string, BucketDefinition>;
    enabledServices: Set<CouchbaseService>;
    customServiceQuotas: Map<CouchbaseService, number>;
    isEnterprise: boolean;
} & CouchbasePorts;

/**
 * Handles configuring the Couchbase cluster and setting up buckets/scopes/collections/indexes for use
 */
export class CouchbaseConfigurationService {
    #instance: AxiosInstance;

    constructor(
        private container: CouchbaseContainerFacade,
        private startedContainer: StartedTestContainer
    ) {
        this.#instance = this.getNewInstance();
    }

    /**
     * Configures an AxiosInstance with baseURL and Basic auth already setup.
     * Defaults to use MGMT_PORT since this is the most used during configuration
     * @param port Which couchbase port the instance will target
     */
    private getNewInstance(
        port: keyof CouchbasePorts = 'MGMT_PORT'
    ): AxiosInstance {
        return axios.create({
            baseURL: `http://${this.startedContainer.getHost()}:${this.startedContainer.getMappedPort(
                this.container[port]
            )}`,
            auth: {
                username: this.container.username,
                password: this.container.userPassword,
            },
        });
    }

    /**
     * Prepares cluster for data
     */
    public async configureCluster(): Promise<void> {
        await this.untilNodeIsOnline();
        await this.initializeIsEnterprise();
        await this.renameNode();
        await this.initializeServices();
        await this.setMemoryQuotas();
        await this.configureAdminUser();
        await this.configureExternalPorts();

        if (this.container.enabledServices.has(CouchbaseService.INDEX)) {
            await this.configureIndexer();
        }
    }

    /**
     * Based on the user-configured bucket definitions, creating buckets and corresponding indexes if needed.
     */
    public async createBuckets(): Promise<void> {
        log.debug(
            `Creating ${this.container.buckets.size} bucket(s) (and corresponding indexes).`
        );
        await Promise.all(
            Array.from(this.container.buckets.values()).map((bucket) =>
                this.createBucket(bucket)
            )
        );
    }

    /**
     * Before we can start configuring the host, we need to wait until the cluster manager is listening.
     */
    private async untilNodeIsOnline(): Promise<void> {
        const result = await new IntervalRetryStrategy<
            AxiosResponse | void,
            'failed'
        >(1000).retryUntil(
            async () => {
                try {
                    const response = await this.#instance.get('/pools');
                    return response;
                } catch (e) {
                    log.debug((<Error>e).message);
                }
            },
            (result) => {
                return result?.status === 200 ? true : false;
            },
            () => {
                return 'failed';
            },
            60000
        );
        if (result === 'failed') {
            throw new Error('Timeout waiting for node to be online');
        }
    }

    /**
     * Fetches edition (enterprise or community) of started container.
     */
    private async initializeIsEnterprise(): Promise<void> {
        const response = await new IntervalRetryStrategy<
            AxiosResponse,
            'failed'
        >(1000).retryUntil(
            async () => {
                const response = await this.#instance.get('/pools');
                return response;
            },
            (result) => {
                return result.status === 200 ? true : false;
            },
            () => {
                return 'failed';
            },
            60000
        );
        if (response === 'failed') {
            throw new Error(
                'Unable to determine whether image is an Enterprise version'
            );
        }
        this.container.isEnterprise = response.data.isEnterprise;

        if (!this.container.isEnterprise) {
            if (
                this.container.enabledServices.has(CouchbaseService.ANALYTICS)
            ) {
                throw new Error(
                    'The Analytics Service is only supported with the Enterprise version'
                );
            }
            if (this.container.enabledServices.has(CouchbaseService.EVENTING)) {
                throw new Error(
                    'The Eventing Service is only supported with the Enterprise version'
                );
            }
        }
    }

    /**
     * Rebinds/renames the internal hostname.
     * <p>
     * To make sure the internal hostname is different from the external (alternate) address and the SDK can pick it
     * up automatically, we bind the internal hostname to the internal IP address.
     */
    private async renameNode(): Promise<void> {
        const newHost = this.startedContainer.getIpAddress(
            this.startedContainer.getNetworkNames()[0]
        );
        log.debug(`Renaming Couchbase Node from localhost to ${newHost}`);

        const body = new URLSearchParams({
            hostname: newHost,
        });
        await this.#instance.post('/node/controller/rename', body);
    }

    /**
     * Initializes services based on the configured enabled services.
     */
    private async initializeServices(): Promise<void> {
        const services = Array.from(this.container.enabledServices)
            .map((service) => service.getIdentifier())
            .join(',');
        log.debug(`Initializing couchbase services on host: ${services}`);

        const body = new URLSearchParams({
            services,
        });
        try {
            await this.#instance.post('/node/controller/setupServices', body);
        } catch (e) {
            throw new Error('Could not enable couchbase services');
        }
    }

    /**
     * Sets the memory quotas for each enabled service.
     * <p>
     * If there is no explicit custom quota defined, the default minimum quota will be used.
     */
    private async setMemoryQuotas(): Promise<void> {
        log.debug(
            `Custom service memory quotas: ${this.container.customServiceQuotas}`
        );

        const quotas = new URLSearchParams();
        this.container.enabledServices.forEach((service) => {
            if (!service.hasQuota()) {
                return;
            }

            const quota = this.container.customServiceQuotas.has(service)
                ? <number>this.container.customServiceQuotas.get(service)
                : service.getMinimumQuotaMb();
            if (CouchbaseService.KV === service) {
                quotas.append('memoryQuota', quota.toString());
            } else {
                quotas.append(
                    `${service.getIdentifier()}MemoryQuota`,
                    quota.toString()
                );
            }
        });
        try {
            await this.#instance.post('/pools/default', quotas);
        } catch (e) {
            throw new Error('Could not configure service memory quotas');
        }
    }

    /**
     * Configures the admin user on the couchbase node.
     * <p>
     * After this.container stage, all subsequent API calls need to have the basic auth header set.
     */
    private async configureAdminUser(): Promise<void> {
        log.debug(
            `Configuring couchbase admin user with username: ${this.container.username}`
        );

        const body = new URLSearchParams({
            username: this.container.username,
            password: this.container.userPassword,
            port: 'SAME',
        });
        try {
            await this.#instance.post('/settings/web', body);
        } catch (e) {
            throw new Error('Could not configure couchbase admin user');
        }
    }

    /**
     * Configures the external ports for SDK access.
     * <p>
     * Since the internal ports are not accessible from outside the container, this.container code configures the "external"
     * hostname and services to align with the mapped ports. The SDK will pick it up and then automatically connect
     * to those ports. Note that for all services non-ssl and ssl ports are configured.
     */
    private async configureExternalPorts(): Promise<void> {
        log.debug(
            'Mapping external ports to the alternate address configuration'
        );

        const body = new URLSearchParams({
            hostname: this.startedContainer.getHost(),
            mgmt: this.startedContainer
                .getMappedPort(this.container.MGMT_PORT)
                .toString(),
            mgmtSSL: this.startedContainer
                .getMappedPort(this.container.MGMT_SSL_PORT)
                .toString(),
        });
        if (this.container.enabledServices.has(CouchbaseService.KV)) {
            body.append(
                'kv',
                this.startedContainer
                    .getMappedPort(this.container.KV_PORT)
                    .toString()
            );
            body.append(
                'kvSSL',
                this.startedContainer
                    .getMappedPort(this.container.KV_SSL_PORT)
                    .toString()
            );
            body.append(
                'capi',
                this.startedContainer
                    .getMappedPort(this.container.VIEW_PORT)
                    .toString()
            );
            body.append(
                'capiSSL',
                this.startedContainer
                    .getMappedPort(this.container.VIEW_SSL_PORT)
                    .toString()
            );
        }

        if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
            body.append(
                'n1ql',
                this.startedContainer
                    .getMappedPort(this.container.QUERY_PORT)
                    .toString()
            );
            body.append(
                'n1qlSSL',
                this.startedContainer
                    .getMappedPort(this.container.QUERY_SSL_PORT)
                    .toString()
            );
        }

        if (this.container.enabledServices.has(CouchbaseService.SEARCH)) {
            body.append(
                'fts',
                this.startedContainer
                    .getMappedPort(this.container.SEARCH_PORT)
                    .toString()
            );
            body.append(
                'ftsSSL',
                this.startedContainer
                    .getMappedPort(this.container.SEARCH_SSL_PORT)
                    .toString()
            );
        }

        if (this.container.enabledServices.has(CouchbaseService.ANALYTICS)) {
            body.append(
                'cbas',
                this.startedContainer
                    .getMappedPort(this.container.ANALYTICS_PORT)
                    .toString()
            );
            body.append(
                'cbasSSL',
                this.startedContainer
                    .getMappedPort(this.container.ANALYTICS_SSL_PORT)
                    .toString()
            );
        }

        if (this.container.enabledServices.has(CouchbaseService.EVENTING)) {
            body.append(
                'eventingAdminPort',
                this.startedContainer
                    .getMappedPort(this.container.EVENTING_PORT)
                    .toString()
            );
            body.append(
                'eventingSSL',
                this.startedContainer
                    .getMappedPort(this.container.EVENTING_SSL_PORT)
                    .toString()
            );
        }

        try {
            await this.#instance.put(
                '/node/controller/setupAlternateAddresses/external',
                body
            );
        } catch (e) {
            throw new Error('Could not configure external ports');
        }
    }

    /**
     * Configures the indexer service so that indexes can be created later on the bucket.
     */
    private async configureIndexer(): Promise<void> {
        log.debug('Configuring the indexer service');

        const body = new URLSearchParams({
            storageMode: this.container.isEnterprise
                ? 'memory_optimized'
                : 'forestdb',
        });
        try {
            await this.#instance.post('/settings/indexes', body);
        } catch (e) {
            throw new Error('Could not configure the indexing service');
        }
    }

    private async createBucket(bucket: BucketDefinition): Promise<void> {
        await this.buildBucket(bucket);
        await this.waitForAllServicesEnabledForBucket(bucket);
        if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
            await this.waitForQueryKeyspacePresent(bucket);
        }
        if (bucket.hasPrimaryIndex() === true) {
            if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
                await this.buildPrimaryIndex(bucket);
                await this.waitForBucketPrimaryIndexOnline(bucket);
            } else {
                log.info(
                    `Primary index creation for bucket ${bucket.name} ignored, since QUERY service is not present.`
                );
            }
        }
        if (bucket.hasScopes) {
            await this.createScopes(bucket);
        }
    }

    private async buildBucket(bucket: BucketDefinition): Promise<void> {
        log.debug(`Creating bucket ${bucket.name}`);

        const body = new URLSearchParams({
            name: bucket.name,
            ramQuotaMB: bucket.quota.toString(),
            flushEnabled: bucket.flushEnabled === true ? '1' : '0',
        });
        log.debug(body.toString());

        try {
            await this.#instance.post('/pools/default/buckets', body);
        } catch (e) {
            throw new Error(`Could not create bucket ${bucket.name}`);
        }
    }

    private async waitForAllServicesEnabledForBucket(
        bucket: BucketDefinition
    ): Promise<void> {
        log.debug(
            `Waiting for all services enabled for bucket: ${bucket.name}`
        );
        await new IntervalRetryStrategy<AxiosResponse, void>(1000).retryUntil(
            async () => {
                const response = await this.#instance.get(
                    `/pools/default/b/${bucket.name}`
                );
                return response;
            },
            (result) => {
                try {
                    if (result.data.nodesExt?.[0]) {
                        return Array.from(this.container.enabledServices).every(
                            (enabledService) =>
                                Object.keys(
                                    result.data.nodesExt?.[0].services || {}
                                )?.some((service) =>
                                    service.startsWith(
                                        enabledService.getIdentifier()
                                    )
                                )
                        );
                    }
                    return false;
                } catch (e) {
                    log.trace((<Error>e).message);
                    return false;
                }
            },
            () => {},
            60000
        );
    }

    private async waitForQueryKeyspacePresent(bucket: BucketDefinition) {
        // If the query service is enabled, make sure that we only proceed if the query engine also
        // knows about the bucket in its metadata configuration.
        log.debug(
            `Waiting for query keyspace present for bucket ${bucket.name}`
        );
        await new IntervalRetryStrategy<AxiosResponse | void, void>(
            1000
        ).retryUntil(
            async () => {
                const body = new URLSearchParams({
                    statement: `SELECT COUNT(*) > 0 AS present FROM system:keyspaces WHERE name = "${bucket.name}"`,
                });
                const response = await this.getNewInstance('QUERY_PORT').post(
                    '/query/service',
                    body
                );
                return response;
            },
            (result) => {
                return result?.data?.results?.[0]?.present ? true : false;
            },
            () => {},
            60000
        );
    }

    private async buildPrimaryIndex(bucket: BucketDefinition) {
        log.debug(`Building primary index for bucket: ${bucket.name}`);
        const body = new URLSearchParams({
            statement: `CREATE PRIMARY INDEX on \`${bucket.name}\``,
        });
        try {
            await this.getNewInstance('QUERY_PORT').post(
                '/query/service',
                body
            );
        } catch (e) {
            // potentially ignore the error, the index will be eventually built.
            if (
                !(<Error>e).message?.includes(
                    'will retry building in the background'
                )
            ) {
                throw e;
            }
        }
    }

    private async waitForBucketPrimaryIndexOnline(
        bucket: BucketDefinition
    ): Promise<void> {
        log.debug(
            `Waiting for primary index to be online for bucket: ${bucket.name}`
        );
        await new IntervalRetryStrategy<AxiosResponse, void>(1000).retryUntil(
            async () => {
                const body = new URLSearchParams({
                    statement: `SELECT COUNT(*) > 0 AS online FROM system:indexes WHERE keyspace_id =\`"${bucket.name}"\`
                     AND is_primary = true AND state = "online"`,
                });
                const response = await this.getNewInstance('QUERY_PORT').post(
                    '/query/service',
                    body
                );
                return response;
            },
            (result) => {
                return result.data?.results?.[0]?.online ? true : false;
            },
            () => {},
            60000
        );
    }

    private async createScopes(bucket: BucketDefinition): Promise<void> {
        log.debug(`Creating ${bucket.scopes.size} scope(s).`);
        await Promise.all(
            Array.from(bucket.scopes.values()).map((scope) =>
                this.createScope(bucket, scope)
            )
        );
    }

    private async createScope(
        bucket: BucketDefinition,
        scope: ScopeDefinition
    ): Promise<void> {
        await this.buildScope(bucket, scope);
        await this.createCollections(bucket, scope);
    }

    private async buildScope(
        bucket: BucketDefinition,
        scope: ScopeDefinition
    ): Promise<void> {
        log.debug(`Creating scope ${scope.getName()}`);

        const body = new URLSearchParams({
            name: scope.getName(),
        });
        try {
            await this.#instance.post(
                `/pools/default/buckets/${bucket.name}/scopes`,
                body
            );
        } catch (e) {
            throw new Error(`Could not create scope ${scope.getName()}`);
        }
    }

    private async createCollections(
        bucket: BucketDefinition,
        scope: ScopeDefinition
    ): Promise<void> {
        log.debug(`Creating ${bucket.scopes.size} collection(s).`);
        await Promise.all(
            Array.from(scope.getCollections().values()).map((collection) =>
                this.createCollection(bucket, scope, collection)
            )
        );
    }

    private async createCollection(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ): Promise<void> {
        await this.buildCollection(bucket, scope, collection);
        if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
            await this.waitForQueryKeyspacePresentForCollection(
                bucket,
                scope,
                collection
            );
        }
        if (collection.hasPrimaryIndex() === true) {
            if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
                await this.buildPrimaryIndexForCollection(
                    bucket,
                    scope,
                    collection
                );
                await this.waitForCollectionPrimaryIndexOnline(
                    bucket,
                    scope,
                    collection
                );
            } else {
                log.info(
                    `Primary index creation for collection ${collection.getName()} ignored, since QUERY service is not present.`
                );
            }
        }
        if (collection.hasSecondaryIndexes() === true) {
            if (this.container.enabledServices.has(CouchbaseService.QUERY)) {
                await Promise.all(
                    collection
                        .getSecondaryIndexes()
                        .map((indexDefinition) =>
                            this.buildSecondaryIndexForCollection(
                                bucket,
                                scope,
                                collection,
                                indexDefinition
                            )
                        )
                );
                await this.waitForCollectionSecondaryIndexesOnline(
                    bucket,
                    scope,
                    collection
                );
            } else {
                log.info(
                    `Secondary index creation for collection ${collection.getName()} ignored, since QUERY service is not present.`
                );
            }
        }
    }

    private async buildCollection(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ) {
        log.debug(
            `Building collection: ${collection.getName()} (and corresponding indexes)`
        );
        const body = new URLSearchParams({
            name: collection.getName(),
            maxTTL: collection.getMaxTTL().toString(),
        });
        try {
            await this.#instance.post(
                `/pools/default/buckets/${
                    bucket.name
                }/scopes/${scope.getName()}/collections`,
                body
            );
        } catch (e) {
            throw new Error(
                `Could not create collection ${
                    bucket.name
                }:${collection.getName()}:${collection.getName()}`
            );
        }
    }

    private async waitForQueryKeyspacePresentForCollection(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ): Promise<void> {
        log.debug(
            `Waiting for keyspace to be ready for collection: ${
                bucket.name
            }.${scope.getName()}.${collection.getName()}`
        );
        await new IntervalRetryStrategy<AxiosResponse, void>(1000).retryUntil(
            async () => {
                const body = new URLSearchParams({
                    statement: `
                        SELECT 
                            COUNT(*) > 0 AS present 
                        FROM system:keyspaces 
                        WHERE 
                            \`bucket\` = "${bucket.name}" AND 
                            \`scope\` = "${scope.getName()}" AND 
                            \`name\` = "${collection.getName()}"`,
                });
                const response = await this.getNewInstance('QUERY_PORT').post(
                    '/query/service',
                    body
                );
                return response;
            },
            (result) => {
                return result.data?.results?.[0]?.present ? true : false;
            },
            () => {},
            60000
        );
    }

    private async buildPrimaryIndexForCollection(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ): Promise<void> {
        log.debug(
            `Building primary index for collection: ${
                bucket.name
            }.${scope.getName()}.${collection.getName()}`
        );

        const body = new URLSearchParams({
            statement: `CREATE PRIMARY INDEX on \`${
                bucket.name
            }\`.\`${scope.getName()}\`.\`${collection.getName()}\``,
        });
        try {
            await this.getNewInstance('QUERY_PORT').post(
                '/query/service',
                body
            );
        } catch (e) {
            // potentially ignore the error, the index will be eventually built.
            if (axios.isAxiosError(e)) {
                if (
                    e.response?.data?.errors?.[0]?.msg?.includes(
                        'Index creation will be retried in background'
                    )
                ) {
                    log.debug(
                        `Index creation for ${
                            bucket.name
                        }.${scope.getName()}.${collection.getName()} deferred to the background`
                    );
                }
            }
            if (
                (<Error>e).message?.includes(
                    'Index creation will be retried in background'
                )
            ) {
                log.debug(
                    `Index creation for ${
                        bucket.name
                    }.${scope.getName()}.${collection.getName()} deferred to the background`
                );
            } else {
                throw e;
            }
        }
    }

    private async waitForCollectionPrimaryIndexOnline(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ): Promise<void> {
        log.debug(
            `Waiting for primary index to come online for collection: ${
                bucket.name
            }.${scope.getName()}.${collection.getName()}`
        );

        await new IntervalRetryStrategy<AxiosResponse, void>(1000).retryUntil(
            async () => {
                const body = new URLSearchParams({
                    statement: `
                        SELECT 
                            COUNT(*) > 0 AS online 
                        FROM system:indexes 
                        WHERE 
                            bucket_id ="${bucket.name}" AND
                            scope_id = "${scope.getName()}" AND
                            keyspace_id = "${collection.getName()}" AND
                            is_primary = true AND
                            state = "online"`,
                });
                const response = await this.getNewInstance('QUERY_PORT').post(
                    '/query/service',
                    body
                );
                return response;
            },
            (result) => {
                return result.data?.results?.[0]?.online ? true : false;
            },
            () => {},
            60000
        );
    }

    private async buildSecondaryIndexForCollection(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition,
        indexDefinition: string
    ): Promise<void> {
        log.debug(
            `Building secondary index for collection: ${
                bucket.name
            }.${scope.getName()}.${collection.getName()}`
        );

        const body = new URLSearchParams({
            statement: indexDefinition,
        });
        try {
            await this.getNewInstance('QUERY_PORT').post(
                '/query/service',
                body
            );
        } catch (e) {
            // potentially ignore the error, the index will be eventually built.
            if (axios.isAxiosError(e)) {
                if (
                    (<any>e.response?.data)?.errors?.[0]?.msg?.includes(
                        'Index creation will be retried in background'
                    )
                ) {
                    log.debug(
                        `Index creation for ${
                            bucket.name
                        }.${scope.getName()}.${collection.getName()} deferred to the background`
                    );
                }
            }
            if (
                (<Error>e).message?.includes(
                    'Index creation will be retried in background'
                )
            ) {
                log.debug(
                    `Index creation for ${
                        bucket.name
                    }.${scope.getName()}.${collection.getName()} deferred to the background`
                );
            } else {
                throw e;
            }
        }
    }

    private async waitForCollectionSecondaryIndexesOnline(
        bucket: BucketDefinition,
        scope: ScopeDefinition,
        collection: CollectionDefinition
    ): Promise<void> {
        log.debug(
            `Waiting for secondary indexes to come online for collection: ${
                bucket.name
            }.${scope.getName()}.${collection.getName()}`
        );

        await new IntervalRetryStrategy<AxiosResponse, void>(1000).retryUntil(
            async () => {
                const body = new URLSearchParams({
                    statement: `
                        SELECT 
                            state
                        FROM system:indexes 
                        WHERE 
                            bucket_id ="${bucket.name}" AND
                            scope_id = "${scope.getName()}" AND
                            keyspace_id = "${collection.getName()}" AND
                            is_primary IS MISSING`,
                });
                const response = await this.getNewInstance('QUERY_PORT').post(
                    '/query/service',
                    body
                );
                return response;
            },
            (result) => {
                return (<{ state: 'online' | 'offline' }[]>(
                    result.data?.results
                ))?.every((result) => result.state === 'online')
                    ? true
                    : false;
            },
            () => {},
            60000
        );
    }
}
