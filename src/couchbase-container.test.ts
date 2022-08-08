import { jest } from '@jest/globals';
import couchbase, {
    BucketSettings,
    Cluster,
    CollectionManager,
    QueryScanConsistency,
} from 'couchbase';
import { BucketDefinition } from './bucket-definition.js';
import { CollectionDefinition } from './collection-definition.js';
import {
    CouchbaseContainer,
    StartedCouchbaseContainer,
} from './couchbase-container.js';
import { CouchbaseService } from './couchbase-service.js';
import { ScopeDefinition } from './scope-definition.js';

const COUCHBASE_IMAGE_COMMUNITY = 'couchbase/server:community-7.1.1';

describe('CouchbaseContainer', () => {
    jest.setTimeout(240_000);
    let container: StartedCouchbaseContainer;
    let containerFromFile: StartedCouchbaseContainer;

    beforeAll(async () => {
        [container, containerFromFile] = await Promise.all([
            new CouchbaseContainer()
                .withBucket(
                    new BucketDefinition('testBucket').withScope(
                        new ScopeDefinition('testScope').withCollection(
                            new CollectionDefinition('testCollection')
                        )
                    )
                )
                .withAnalyticsService()
                .withEventingService()
                .withCredentials('testUser', 'testPassword')
                .start(),
            new CouchbaseContainer().fromCouchbaseFile().start(),
        ]);
    });

    describe('container', () => {
        it('should connect with the SDK using supplied credentials', async () => {
            await couchbase.connect(container.getConnectionString(), {
                username: 'testUser',
                password: 'testPassword',
            });
        });

        it('should perform key/value and query operations in collection', async () => {
            const cluster = await couchbase.connect(
                container.getConnectionString(),
                {
                    username: container.getUsername(),
                    password: container.getPassword(),
                }
            );
            const collection = cluster
                .bucket('testBucket')
                .scope('testScope')
                .collection('testCollection');
            const testDoc = {
                foo: 'bar',
            };
            await collection.upsert('testDoc', testDoc);
            const returnedDoc = (await collection.get('testDoc')).content;
            const queriedDoc = (
                await cluster.query(
                    'SELECT testCollection.* FROM testBucket.testScope.testCollection',
                    { scanConsistency: QueryScanConsistency.RequestPlus }
                )
            ).rows[0];
            expect(testDoc).toEqual(returnedDoc);
            expect(testDoc).toEqual(queriedDoc);
            await cluster.close();
        });

        it('should have the Analytics service enabled', async () => {
            const cluster = await couchbase.connect(
                container.getConnectionString(),
                {
                    username: container.getUsername(),
                    password: container.getPassword(),
                }
            );
            const pingResponse = await cluster.ping();

            expect(pingResponse.services.analytics).toBeTruthy();
        });

        it('should have the Eventing service enabled', async () => {
            const cluster = await couchbase.connect(
                container.getConnectionString(),
                {
                    username: container.getUsername(),
                    password: container.getPassword(),
                }
            );
            const pingResponse = await cluster.ping();
            expect(
                pingResponse.services[CouchbaseService.EVENTING.getIdentifier()]
            ).toBeTruthy();
        });
    });

    describe('community edition', () => {
        it('should fail fast if the Analytics service is added', async () => {
            expect.assertions(1);
            await expect(
                async () =>
                    await new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY)
                        .withAnalyticsService()
                        .start()
            ).rejects.toThrow();
        });

        it('should fail fast if the Eventing service is added', async () => {
            expect.assertions(1);
            await expect(async () => {
                await new CouchbaseContainer(COUCHBASE_IMAGE_COMMUNITY)
                    .withEventingService()
                    .start();
            }).rejects.toThrow();
        });
    });

    describe('container from CouchbaseFile', () => {
        let cluster: Cluster;
        beforeAll(async () => {
            cluster = await couchbase.connect(
                containerFromFile.getConnectionString(),
                {
                    username: containerFromFile.getUsername(),
                    password: containerFromFile.getPassword(),
                }
            );
        });

        describe('services', () => {
            it.todo('should check services here');
            it.todo('should check service quotas');
        });

        describe('buckets', () => {
            let bucketSettings: BucketSettings[];
            let collectionManagersByBucket: {
                bucket: string;
                manager: CollectionManager;
            }[];
            beforeAll(async () => {
                bucketSettings = await cluster.buckets().getAllBuckets();
                const buckets = await Promise.all(
                    bucketSettings.map((bucket) => cluster.bucket(bucket.name))
                );
                collectionManagersByBucket = await Promise.all(
                    buckets.map((bucket) => {
                        return {
                            bucket: bucket.name,
                            manager: bucket.collections(),
                        };
                    })
                );
            });

            it('should have all buckets', () => {
                const bucketNames = bucketSettings.map((bucket) => bucket.name);
                expect(bucketNames).toContain('testbucket1');
                expect(bucketNames).toContain('testBucketWithoutIndex');
                expect(bucketNames).toContain('testBucketWithQuota');
            });

            // SDK always returns string instead of boolean
            it.skip('should configure testbucket1 with flushEnabled', () => {
                expect(
                    bucketSettings.find(
                        (bucket) => bucket.name === 'testbucket1'
                    )?.flushEnabled
                ).toEqual(true);
            });

            // SDK always returns undefined instead of number
            it.skip('should configure testBucketWithQuota to have a quota of 150MB', () => {
                expect(
                    bucketSettings.find(
                        (bucket) => bucket.name === 'testBucketWithQuota'
                    )?.ramQuotaMB
                ).toEqual(150);
            });

            it('should configure primary indexes', async () => {
                const queryIndexesByBucket = await Promise.all(
                    bucketSettings
                        .map((bucket) => bucket.name)
                        .map(async (bucketName) => {
                            return {
                                bucket: bucketName,
                                queryIndexes: await cluster
                                    .queryIndexes()
                                    .getAllIndexes(bucketName),
                            };
                        })
                );
                // Every bucket has primary index except testBucketWithoutIndex
                const bucketsThatNeedThemHavePrimaryIndexes =
                    queryIndexesByBucket.every(
                        (queryIndexByBucket) =>
                            queryIndexByBucket.queryIndexes.some(
                                (queryIndex) =>
                                    queryIndex.isPrimary &&
                                    queryIndex.bucketName ===
                                        queryIndexByBucket.bucket
                            ) ||
                            queryIndexByBucket.bucket ===
                                'testBucketWithoutIndex'
                    );
                expect(bucketsThatNeedThemHavePrimaryIndexes).toEqual(true);

                const collectionsThatNeedThemHavePrimaryIndexes = [
                    'testCollection1',
                    'testCollectionWithTTL',
                ].every((collection) =>
                    queryIndexesByBucket.some((queryIndexByBucket) =>
                        queryIndexByBucket.queryIndexes.some(
                            (queryIndex) =>
                                queryIndex.isPrimary &&
                                queryIndex.collectionName === collection
                        )
                    )
                );
                expect(collectionsThatNeedThemHavePrimaryIndexes).toEqual(true);

                const noPrimaryIndexForTestCollectionWithoutIndex =
                    queryIndexesByBucket
                        .flatMap(
                            (queryIndexByBucket) =>
                                queryIndexByBucket.queryIndexes
                        )
                        .every(
                            (index) =>
                                index.collectionName !==
                                'testCollectionWithoutIndex'
                        );
                expect(noPrimaryIndexForTestCollectionWithoutIndex).toEqual(
                    true
                );
            });
            describe('scopes', () => {
                it('should configure scopes properly', async () => {
                    const scopeSpecsByBucket = await Promise.all(
                        collectionManagersByBucket.map(
                            async (collectionManagerByBucket) => {
                                return {
                                    bucket: collectionManagerByBucket.bucket,
                                    scopeSpecs:
                                        await collectionManagerByBucket.manager.getAllScopes(),
                                };
                            }
                        )
                    );
                    const scopesByBucket = scopeSpecsByBucket.map(
                        (scopeSpecByBucket) => {
                            return {
                                bucket: scopeSpecByBucket.bucket,
                                scopes: scopeSpecByBucket.scopeSpecs
                                    .map((scopeSpec) => scopeSpec.name)
                                    .sort(),
                            };
                        }
                    );
                    expect(scopesByBucket).toContainEqual({
                        bucket: 'testbucket1',
                        scopes: ['_default', 'testScope1', 'testScope2'],
                    });
                    expect(scopesByBucket).toContainEqual({
                        bucket: 'testBucketWithoutIndex',
                        scopes: ['_default'],
                    });
                    expect(scopesByBucket).toContainEqual({
                        bucket: 'testBucketWithQuota',
                        scopes: ['_default'],
                    });
                });
            });

            describe('collections', () => {
                it('should drop document from testCollectionWithTTL after 1 second', async () => {
                    const collection = cluster
                        .bucket('testbucket1')
                        .scope('testScope2')
                        .collection('testCollectionWithTTL');
                    await collection.upsert('test', {});
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    const exists = (await collection.exists('test')).exists;
                    expect(exists).toEqual(false);
                });
            });
        });

        afterAll(async () => {
            await cluster.close();
        });
    });

    afterAll(async () => {
        await Promise.all([container.stop(), containerFromFile.stop()]);
    });
});
