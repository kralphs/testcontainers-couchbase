export class CollectionDefinition {
    #name: string;

    #maxTTL = 0;

    #queryPrimaryIndex = true;

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

    public getName(): string {
        return this.#name;
    }

    public getMaxTTL(): number {
        return this.#maxTTL;
    }

    public hasPrimaryIndex(): boolean {
        return this.#queryPrimaryIndex;
    }
}
