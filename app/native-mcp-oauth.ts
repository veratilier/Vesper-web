import { Capacitor } from '@capacitor/core';

type NativeBridge = {
  nativePromise?: (plugin: string, method: string, options: { url: string }) => Promise<{ url: string }>;
};

// Resolve the live bridge on each click. registerPlugin captures plugin headers
// at module evaluation, which need not reflect the currently injected bridge.
export async function withOAuthDeadline<T>(operation: Promise<T>, timeoutMs = 90000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The iOS authorization session did not respond. Close any authorization window before retrying. If no window appeared, check the Xcode console for VesperOAuth plugin loading errors.')), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function authorizeWithBridge(bridge: NativeBridge, options: { url: string }): Promise<{ url: string }> {
  if (typeof bridge.nativePromise !== 'function') {
    throw new Error('The iOS bridge is unavailable. Reopen Vesper and try again.');
  }
  try {
    return await withOAuthDeadline(bridge.nativePromise('VesperOAuth', 'authorize', options));
  } catch (error) {
    const reason = error as { code?: string; message?: string };
    if (reason?.code === 'UNIMPLEMENTED' || /not implemented|not found/i.test(reason?.message || '')) {
      throw new Error('The iOS bridge responded, but VesperOAuth is not registered in this App build. Check the Xcode target and native plugin registration.');
    }
    throw error;
  }
}

export const nativeMcpOAuth = {
  authorize: (options: { url: string }) => authorizeWithBridge(
    (typeof window !== 'undefined' ? (window as Window & { Capacitor?: NativeBridge }).Capacitor : undefined)
      || Capacitor as unknown as NativeBridge,
    options,
  ),
};
