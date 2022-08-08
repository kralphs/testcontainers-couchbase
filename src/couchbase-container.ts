import assert from 'assert';
import { readFileSync } from 'node:fs';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { AbstractStartedContainer } from 'testcontainers/dist/modules/abstract-started-container.js';
import { RandomUuid } from 'testcontainers/dist/uuid.js';
import { BucketDefinition } from './bucket-definition.js';
import {
    CouchbaseConfigurationService,
    CouchbaseContainerFacade,
} from './couchbase-configuration.service.js';
import { CouchbaseService, CouchbaseServiceName } from './couchbase-service.js';
import yaml from 'yaml';
import { ScopeDefinition } from './scope-definition.js';
import { CollectionDefinition } from './collection-definition.js';

interface CouchbaseFileSchema {
    services?: { name: CouchbaseServiceName; quota?: number }[];
    buckets?: {
        name: string;
        hasPrimaryIndex?: boolean;
        quota: number;
        withFlushEnabled?: boolean;
        scopes?: {
            name: string;
            collections?: {
                name: string;
                maxTTL?: number;
                hasPrimaryIndex?: boolean;
            }[];
        }[];
    }[];
}

/**
 * The couchbase container initializes and configures a Couchbase Server single node cluster.
 * <p>
 * Note that it does not depend on a specific couchbase SDK. It's recommended using the latest and greatest SDKs for the best experience.
 */
export class CouchbaseContainer extends GenericContainer {
    private MGMT_PORT = 8091;
    private MGMT_SSL_PORT = 18091;
    private VIEW_PORT = 8092;
    private VIEW_SSL_PORT = 18092;
    private QUERY_PORT = 8093;
    private QUERY_SSL_PORT = 18093;
    private SEARCH_PORT = 8094;
    private SEARCH_SSL_PORT = 18094;
    private ANALYTICS_PORT = 8095;
    private ANALYTICS_SSL_PORT = 18095;
    private EVENTING_PORT = 8096;
    private EVENTING_SSL_PORT = 18096;
    private KV_PORT = 11210;
    private KV_SSL_PORT = 11207;

    private username = 'Administrator';
    private userPassword = new RandomUuid().nextUuid();
    private buckets: Map<string, BucketDefinition> = new Map();

    /**
     * Holds the custom service quotas if configured by the user.
     */
    private customServiceQuotas: Map<CouchbaseService, number> = new Map();

    /**
     * Enabled services does not include Analytics since most users likely do not need to test
     * with it and is also a little heavy on memory and runtime requirements. Also, it is only
     * available with the enterprise edition (EE).
     */
    private enabledServices: Set<CouchbaseService> = new Set([
        CouchbaseService.KV,
        CouchbaseService.QUERY,
        CouchbaseService.SEARCH,
        CouchbaseService.INDEX,
    ]);

    private isEnterprise = false;

    constructor(image = 'couchbase/server') {
        super(image);
    }

    public fromCouchbaseFile(
        name = 'CouchbaseFile',
        dir = process.cwd()
    ): this {
        const file = readFileSync(path.join(dir, name), 'utf8');
        const config: CouchbaseFileSchema = yaml.parse(file);

        if (config.services) {
            this.withEnabledServices(
                config.services.map((service) => {
                    return CouchbaseService[service.name];
                })
            );
            config.services.forEach((service) => {
                if (service.quota) {
                    this.withServiceQuota(
                        CouchbaseService[service.name],
                        service.quota
                    );
                }
            });
        }

        if (config.buckets) {
            config.buckets.forEach((bucket) => {
                const newBucket = new BucketDefinition(bucket.name);
                newBucket.withPrimaryIndex(
                    bucket.hasPrimaryIndex === false ? false : true
                );
                newBucket.withFlushEnabled(
                    bucket.withFlushEnabled === true ? true : false
                );
                if (bucket.quota) {
                    newBucket.withQuota(bucket.quota);
                }
                bucket.scopes?.forEach((scope) => {
                    const newScope = new ScopeDefinition(scope.name);
                    if (scope.collections) {
                        scope.collections?.forEach((collection) => {
                            const newCollection = new CollectionDefinition(
                                collection.name
                            );
                            newCollection.withMaxTTL(
                                collection.maxTTL ? collection.maxTTL : 0
                            );
                            newCollection.withPrimaryIndex(
                                collection.hasPrimaryIndex === false
                                    ? false
                                    : true
                            );
                            newScope.withCollection(newCollection);
                        });
                    }
                    newBucket.withScope(newScope);
                });
                this.withBucket(newBucket);
            });
        }
        return this;
    }

    public withUsername(username: string): this {
        this.username = username;
        return this;
    }

    public withUserPassword(userPassword: string): this {
        this.userPassword = userPassword;
        return this;
    }

    /**
     * Set custom username and password for the admin user.
     *
     * @param username the admin username to use.
     * @param password the password for the admin user.
     * @return this {@link CouchbaseContainer} for chaining purposes.
     */
    public withCredentials(username: string, password: string): this {
        this.username = username;
        this.userPassword = password;
        return this;
    }

    public withBucket(bucketDefinition: BucketDefinition): this {
        this.buckets.set(bucketDefinition.name, bucketDefinition);
        return this;
    }

    public withEnabledServices(enabled: CouchbaseService[]): this {
        this.enabledServices = new Set(enabled);
        return this;
    }

    /**
     * Configures a custom memory quota for a given service.
     *
     * @param service the service to configure the quota for.
     * @param quotaMb the memory quota in MB.
     * @return this {@link CouchbaseContainer} for chaining purposes.
     */
    public withServiceQuota(service: CouchbaseService, quotaMb: number): this {
        assert.ok(
            service.hasQuota(),
            `The provided service ${service.constructor.name} has no quota to configure`
        );
        assert.ok(
            quotaMb >= service.getMinimumQuotaMb(),
            `The custom quota (${quotaMb}) must not be smaller than the minimum quota for the service (${service.getMinimumQuotaMb})`
        );
        this.customServiceQuotas.set(service, quotaMb);
        return this;
    }

    /**
     * Enables the analytics service which is not enabled by default.
     */
    public withAnalyticsService(): this {
        this.enabledServices.add(CouchbaseService.ANALYTICS);
        return this;
    }

    /**
     * Enables the eventing service which is not enabled by default.
     *
     * @return this {@link CouchbaseContainer} for chaining purposes.
     */
    public withEventingService(): this {
        this.enabledServices.add(CouchbaseService.EVENTING);
        return this;
    }

    public async start(): Promise<StartedCouchbaseContainer> {
        this.withExposedPorts(
            ...(this.hasExposedPorts
                ? this.ports
                : [
                      this.MGMT_PORT,
                      this.MGMT_SSL_PORT,
                      this.VIEW_PORT,
                      this.VIEW_SSL_PORT,
                      this.QUERY_PORT,
                      this.QUERY_SSL_PORT,
                      this.SEARCH_PORT,
                      this.SEARCH_SSL_PORT,
                      this.ANALYTICS_PORT,
                      this.ANALYTICS_SSL_PORT,
                      this.EVENTING_PORT,
                      this.EVENTING_SSL_PORT,
                      this.KV_PORT,
                      this.KV_SSL_PORT,
                  ])
        ).withWaitStrategy(Wait.forLogMessage(/Starting Couchbase Server/));

        return new StartedCouchbaseContainer(
            await super.start(),
            this.username,
            this.userPassword
        );
    }

    protected override async postStart(
        container: StartedTestContainer
    ): Promise<void> {
        const service = new CouchbaseConfigurationService(
            this as unknown as CouchbaseContainerFacade,
            container
        );
        await service.configureCluster();
        await service.createBuckets();
    }
}

export class StartedCouchbaseContainer extends AbstractStartedContainer {
    private MGMT_PORT = 8091;
    private KV_PORT = 11210;

    constructor(
        startedTestContainer: StartedTestContainer,
        private readonly username: string,
        private readonly userPassword: string
    ) {
        super(startedTestContainer);
    }

    public getBootstrapCarrierDirectPort(): number {
        return this.getMappedPort(this.KV_PORT);
    }

    public getBootstrapHttpDirectPort(): number {
        return this.getMappedPort(this.MGMT_PORT);
    }

    public getConnectionString(): string {
        return `couchbase://${this.getHost()}:${this.getBootstrapCarrierDirectPort()}`;
    }

    public getUsername(): string {
        return this.username;
    }

    public getPassword(): string {
        return this.userPassword;
    }
}
