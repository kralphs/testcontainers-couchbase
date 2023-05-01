export class CollectionDefinition {
    #name: string;

    #maxTTL = 0;

    #queryPrimaryIndex = true;

    #secondaryIndexes: string[] = [];

    constructor(name: string) {
        this.#name = name;
    }

    /**
     * Enables flush for this bucket (disabled by default).
     *
     * @param withMaxTTL if true, the bucket can be flushed.
     */
    public withMaxTTL(ttl: number): this {
        this.#maxTTL = ttl;
        return this;
    }

    /**
     * Allows to disable creating a primary index for this bucket (enabled by default).
     *
     * @param create if false, a primary index will not be created.
     */
    public withPrimaryIndex(create: boolean): this {
        this.#queryPrimaryIndex = create;
        return this;
    }

    /**
     * Allows creation of secondary indexes for this bucket.
     *
     * @param indexDefinition SQL++ statement that creates a secondary index
     */
    public withSecondaryIndex(indexDefinition: string): this {
        this.#secondaryIndexes.push(indexDefinition);
        return this;
    }

    public getName(): string {
        return this.#name;
    }

    public getMaxTTL(): number {
        return this.#maxTTL;
    }

    public getSecondaryIndexes(): string[] {
        return this.#secondaryIndexes;
    }

    public hasPrimaryIndex(): boolean {
        return this.#queryPrimaryIndex;
    }

    public hasSecondaryIndexes(): boolean {
        return this.#secondaryIndexes.length > 0;
    }
}
