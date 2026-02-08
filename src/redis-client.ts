import Redis from 'ioredis';

export function createClient() {
    return new Redis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });
}
