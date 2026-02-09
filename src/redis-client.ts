// Mock Redis client that uses in-memory storage (optimized for Render Free Tier)

// In-memory store
const memoryStore = new Map<string, { value: string, expiry: number }>();
const timeouts = new Map<string, NodeJS.Timeout>();

export function createClient() {
    console.log('⚠️  Using IN-MEMORY store (no Redis needed) - Optimized for Render Free Tier');
    
    return {
        async setex(key: string, seconds: number, value: string) {
            const expiry = Date.now() + (seconds * 1000);
            memoryStore.set(key, { value, expiry });
            
            // Auto-cleanup timeout
            if (timeouts.has(key)) {
                clearTimeout(timeouts.get(key));
            }
            
            const timeout = setTimeout(() => {
                memoryStore.delete(key);
                timeouts.delete(key);
            }, seconds * 1000);
            
            timeouts.set(key, timeout);
            return 'OK';
        },
        
        async get(key: string): Promise<string | null> {
            const item = memoryStore.get(key);
            if (!item) return null;
            
            // Check if expired
            if (Date.now() > item.expiry) {
                memoryStore.delete(key);
                if (timeouts.has(key)) {
                    clearTimeout(timeouts.get(key));
                    timeouts.delete(key);
                }
                return null;
            }
            
            return item.value;
        },
        
        async quit() {
            // Clear all timeouts
            for (const timeout of timeouts.values()) {
                clearTimeout(timeout);
            }
            timeouts.clear();
            memoryStore.clear();
            console.log('🧹 Memory store cleaned up');
            return 'OK';
        },
        
        async exists(key: string): Promise<number> {
            const item = memoryStore.get(key);
            if (!item) return 0;
            
            if (Date.now() > item.expiry) {
                memoryStore.delete(key);
                if (timeouts.has(key)) {
                    clearTimeout(timeouts.get(key));
                    timeouts.delete(key);
                }
                return 0;
            }
            
            return 1;
        },
        
        on(event: string, callback: Function) {
            // Mock event handler (for compatibility)
            if (event === 'error') {
                // Ignore errors in mock mode
            }
            return this;
        },
        
        // Add any other methods your code needs
        status: 'ready'
    };
}
