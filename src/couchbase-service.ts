export type CouchbaseServiceName =
    | 'KV'
    | 'QUERY'
    | 'SEARCH'
    | 'INDEX'
    | 'ANALYTICS'
    | 'EVENTING';

export class CouchbaseService {
    /**
     * Key-Value service.
     */
    public static KV = new CouchbaseService('kv', 256);

    /**
     * Query (N1QL) service.
     * <p>
     * Note that the query service has no memory quota, so it is set to 0.
     */
    public static QUERY = new CouchbaseService('n1ql', 0);

    /**
     * Search (FTS) service.
     */
    public static SEARCH = new CouchbaseService('fts', 256);

    /**
     * Indexing service (needed if QUERY is also used!).
     */
    public static INDEX = new CouchbaseService('index', 256);

    /**
     * Analytics service.
     */
    public static ANALYTICS = new CouchbaseService('cbas', 1024);

    /**
     * Eventing service.
     */
    public static EVENTING = new CouchbaseService('eventing', 256);

    private constructor(
        private identifier: string,
        private minimumQuotaMb: number
    ) {}

    public hasQuota(): boolean {
        return this.minimumQuotaMb > 0;
    }

    public getMinimumQuotaMb(): number {
        return this.minimumQuotaMb;
    }

    public getIdentifier(): string {
        return this.identifier;
    }
}
