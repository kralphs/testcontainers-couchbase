# testcontainers-couchbase

A port of the Couchbase module for Java Testcontainers adapted to the NodeJS library.

-   Provides all functionality from the Java module.
-   Includes support for scopes and collections.
-   Allows support for declarative YAML file to configure services and buckets/scopes/collections.
-   Written using ESM.

## Install

```bash
npm i -D @kralphs/testcontainers-couchbase
```

## Future Work

Plan is to incorporate into official Testcontainers, but self-publishing for now. A few modules from testcontainers-node have been integrated wholesale to give a cohesive experience; however, these have now been incorporated into the Node testcontainers package so eventually will incorporate that which will be a breaking change as it will require version ^9.1.

May also change secondary index format to support both string (for explicit control of the query) and an object form that the SQL++ expression will be generated from which can allow for deferred builds to speed things up, etc. Basically, eyeing the possibility of a using the CouchbaseFile for CD as well, and don't want to require separate files to be maintained for each.

Looking into automating importing seed data into collections as well. Likely in the form of a folder hierarchy that matches the bucket/scope/collection structure with documents in the default collections and scopes lying in the base bucket folder. JSON file names will be interpreted as the key.

## Usage

Look at the [test](src/couchbase-container.test.ts) for examples.

Get new single node Couchbase cluster. Defaults to image 'couchbase/server', but can be configured by passing an image name.

```typescript
import { CouchbaseContainer } from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName).start();
```

### Declarative Configuration

Cluster configuration can be done in a declarative fashion. By default, `fromCouchbaseFile()` will look in the current working directory for a file named `CouchbaseFile`. The file location or name can be changed by passing additional arguments as `fromCouchbaseFile(name, dir)`.

The YAML semantics attempt to tightly follow the public API for this module. See [here](./CouchbaseFile) for an example.

```typescript
import { CouchbaseContainer } from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName)
    .fromCouchbaseFile()
    .start();
```

Continue reading for more configuration details.

### Manual Configuration

By default, the node has the Data (KV), Query, Index and Search services enabled. These can be customized. Note: Analytics and Eventing services requires an enterprise image of Couchbase server. The following example would only have a Data service.

```typescript
import {
    CouchbaseContainer,
    CouchbaseService,
} from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName)
    .withServices([CouchbaseService.KV])
    .start();
```

Non-default services can be added without needing to list the default services again

```typescript
import {
    CouchbaseContainer,
    CouchbaseService,
} from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName)
    .withAnalyticsService()
    .withEventingService()
    .start();
```

Each service has a minimum memory quota (MB), but this can be customized.

```typescript
import {
    CouchbaseContainer,
    CouchbaseService,
} from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName)
    .withServiceQuota(CouchbaseService.KV, 512)
    .start();
```

Connect couchbase SDK to the container.

```typescript
import couchbase from 'couchbase';
import { CouchbaseContainer } from '@kralphs/testcontainers-couchbase';

const imageName = 'another/couchbase/server/image';

const container = await new CouchbaseContainer(imageName).start();

const cluster = await couchbase.connect(container.getConnectionString(), {
    username: container.getUsername(),
    password: container.getPassword(),
});
```

Add buckets to the cluster.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const bucket = new BucketDefinition('myBucket');

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

By default, primary indexes are built at the bucket level i.e. using default scope and collection. This can be disabled to save time.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const bucket = new BucketDefinition('myBucket').withPrimaryIndex(false);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

You can also enable bucket flushing and set memory quotas (MB) for the bucket

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const bucket = new BucketDefinition('myBucket')
    .withFlushEnabled(true)
    .withQuota(150);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

Add scope to a bucket. Scopes have no configuration beyond their name.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const scope = new ScopeDefinition('myScope');

const bucket = new BucketDefinition('myBucket').withScope(scope);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

Add collection to a scope. If a scope with that name already exists, its definition will be overwritten.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const collection = new CollectionDefinition('myCollection');

const scope = new ScopeDefinition('myScope').withCollection(collection);

const bucket = new BucketDefinition('myBucket').withScope(scope);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

By default, primary indexes are built on a collection if no secondary indexes are specified. This can be disabled to save time.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const collection = new CollectionDefinition('myCollection').withPrimaryIndex(
    false
);

const scope = new ScopeDefinition('myScope').withCollection(collection);

const bucket = new BucketDefinition('myBucket').withScope(scope);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

MaxTTL can be set on a collection to provide a maximum TTL. Defaults to 0 i.e. no expiration. See [here](https://docs.couchbase.com/server/current/learn/data/expiration.html#expiration-bucket-versus-item) for more details.

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const collection = new CollectionDefinition('myCollection').withMaxTTL(60);

const scope = new ScopeDefinition('myScope').withCollection(collection);

const bucket = new BucketDefinition('myBucket').withScope(scope);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```

Secondary indexes can be built by providing the SQL++ query

```typescript
import {
    CouchbaseContainer,
    BucketDefinition,
} from '@kralphs/testcontainers-couchbase';

const query = 'CREATE INDEX advFoo ON myBucket.myScope.myCollection(foo)';

const collection = new CollectionDefinition('myCollection').withSecondaryIndex(
    query
);

const scope = new ScopeDefinition('myScope').withCollection(collection);

const bucket = new BucketDefinition('myBucket').withScope(scope);

const container = await new CouchbaseContainer().withBucket(bucket).start();
```
