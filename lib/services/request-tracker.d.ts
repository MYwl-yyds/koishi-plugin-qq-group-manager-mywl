export interface TrackedRequest {
    flag: string;
    type: 'friend' | 'join';
    source: 'forward' | 'manual';
}
export declare function trackRequest(messageId: string, meta: TrackedRequest): void;
export declare function lookupRequest(messageId: string): TrackedRequest | undefined;
export declare function quotedMessageId(session: any): string;
