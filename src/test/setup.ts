/**
 * Vitest Test Setup
 *
 * This file is run before each test file.
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

// Mock fetch
global.fetch = vi.fn();

// Mock BroadcastChannel
class MockBroadcastChannel {
  messages: any[] = [];
  onmessage: ((event: any) => void) | null = null;

  constructor(public name: string) {}

  postMessage(message: any) {
    this.messages.push(message);
  }

  addEventListener(event: string, handler: (e: any) => void) {
    if (event === "message") {
      this.onmessage = handler;
    }
  }

  removeEventListener(event: string, handler: (e: any) => void) {
    if (event === "message") {
      this.onmessage = null;
    }
  }

  close() {}
}

(global as any).BroadcastChannel = MockBroadcastChannel;

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver implements IntersectionObserver {
  readonly thresholds: ReadonlyArray<number>;
  readonly root: Element | null;
  readonly rootMargin: string;

  constructor(
    private callback: IntersectionObserverCallback,
    private options?: IntersectionObserverInit,
  ) {
    this.thresholds = options?.threshold ? [options.threshold].flat() : [];
    this.root = options?.root || null;
    this.rootMargin = options?.rootMargin || "";
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

(global as any).IntersectionObserver = MockIntersectionObserver;

// Supabase mock
vi.mock("@/supabase/client", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(() => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(() => ({ error: null })),
      update: vi.fn(() => ({ error: null })),
      delete: vi.fn(() => ({ error: null })),
    })),
  })),
  supabase: {},
}));
