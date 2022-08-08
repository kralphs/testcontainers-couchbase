import assert from 'assert';
import { ScopeDefinition } from './scope-definition.js';

export class BucketDefinition {
    #flushEnabled = false;

    #name: string;

    #queryPrimaryIndex = true;

    #quota = 100;

    #scopes: Map<string, ScopeDefinition> = new Map();

    constructor(name: string) {
        this.#name = name;
    }

    /**
     * Enables flush for this bucket (disabled by default).
     *
     * @param flushEnabled if true, the bucket can be flushed.
     */
    public withFlushEnabled(flushEnabled: boolean): this {
        this.#flushEnabled = flushEnabled;
        return this;
    }

    /**
     * Sets a custom bucket quota (100MB by default).
     *
     * @param quota the quota to set for the bucket.
     */
    public withQuota(quota: number): this {
        assert.ok(quota >= 100, 'Bucket quota cannot be less than 100MB!');
        this.#quota = quota;
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
     * Adds a scope to this bucket.
     *
     * @param scope scope to add; adding a scope that has the same name as another will overwrite the former
     */
    public withScope(scope: ScopeDefinition): this {
        this.#scopes.set(scope.getName(), scope);
        return this;
    }

    public get flushEnabled(): boolean {
        return this.#flushEnabled;
    }

    public hasPrimaryIndex(): boolean {
        return this.#queryPrimaryIndex;
    }

    public get hasScopes(): boolean {
        return this.#scopes.size > 0;
    }

    public get name(): string {
        return this.#name;
    }

    public get quota(): number {
        return this.#quota;
    }

    public get scopes(): Map<string, ScopeDefinition> {
        return this.#scopes;
    }
}
