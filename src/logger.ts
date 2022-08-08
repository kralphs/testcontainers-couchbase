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

import debug, { IDebugger } from 'debug';

type Message = string;

export interface Logger {
    trace(message: Message): void;
    debug(message: Message): void;
    info(message: Message): void;
    warn(message: Message): void;
    error(message: Message): void;
}

class DebugLogger implements Logger {
    private readonly logger: IDebugger;

    constructor(namespace: string) {
        this.logger = debug(namespace);
    }

    public trace(message: Message): void {
        this.logger(`TRACE ${message}`);
    }

    public debug(message: Message): void {
        this.logger(`DEBUG ${message}`);
    }

    public info(message: Message): void {
        this.logger(`INFO  ${message}`);
    }

    public warn(message: Message): void {
        this.logger(`WARN  ${message}`);
    }

    public error(message: Message): void {
        this.logger(`ERROR ${message}`);
    }
}

export class FakeLogger implements Logger {
    public readonly traceLogs: Message[] = [];
    public readonly debugLogs: Message[] = [];
    public readonly infoLogs: Message[] = [];
    public readonly warnLogs: Message[] = [];
    public readonly errorLogs: Message[] = [];

    public trace(message: Message): void {
        this.traceLogs.push(message);
    }

    public debug(message: Message): void {
        this.debugLogs.push(message);
    }

    public info(message: Message): void {
        this.infoLogs.push(message);
    }

    public warn(message: Message): void {
        this.warnLogs.push(message);
    }

    public error(message: Message): void {
        this.errorLogs.push(message);
    }
}

export const log = new DebugLogger('testcontainers');
export const containerLog = new DebugLogger('testcontainers:containers');
