import { CollectionDefinition } from './collection-definition.js';

export class ScopeDefinition {
    #name: string;

    #collections: Map<string, CollectionDefinition> = new Map();

    constructor(name: string) {
        this.#name = name;
    }

    /**
     * Adds a collection to this scope.
     *
     * @param collection collection to add; adding a collection that has the same name as another will overwrite the former
     */
    public withCollection(collection: CollectionDefinition): this {
        this.#collections.set(collection.getName(), collection);
        return this;
    }

    public getName(): string {
        return this.#name;
    }

    public getCollections(): Map<string, CollectionDefinition> {
        return this.#collections;
    }
}
