/**
 * MIT License
 *
 * Copyright (c) 2019 Cristian Greco
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { Clock, SystemClock, Time } from './clock.js';

export interface RetryStrategy<T, U> {
    retryUntil(
        fn: () => Promise<T>,
        predicate: (result: T) => boolean,
        onTimeout: () => U,
        timeout: number
    ): Promise<T | U>;
}

abstract class AbstractRetryStrategy<T, U> implements RetryStrategy<T, U> {
    protected constructor(
        protected readonly clock: Clock = new SystemClock()
    ) {}

    public abstract retryUntil(
        fn: () => Promise<T>,
        predicate: (result: T) => boolean,
        onTimeout: () => U,
        timeout: number
    ): Promise<T | U>;

    protected hasTimedOut(timeout: number, startTime: Time): boolean {
        return this.clock.getTime() - startTime > timeout;
    }

    protected wait(duration: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, duration));
    }
}

export class IntervalRetryStrategy<T, U> extends AbstractRetryStrategy<T, U> {
    constructor(private readonly interval: number) {
        super();
    }

    public async retryUntil(
        fn: () => Promise<T>,
        predicate: (result: T) => boolean,
        onTimeout: () => U,
        timeout: number
    ): Promise<T | U> {
        const startTime = this.clock.getTime();

        let result = await fn();

        while (!predicate(result)) {
            if (this.hasTimedOut(timeout, startTime)) {
                return onTimeout();
            }
            await this.wait(this.interval);
            result = await fn();
        }

        return result;
    }
}
