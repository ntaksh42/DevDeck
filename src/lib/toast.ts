export type Toast = {
  id: number;
  message: string;
  /** When set, the toast shows a Retry button that invokes this. */
  onRetry?: () => void;
};

// Module-scope store so any call site can raise a toast without threading a
// context through the tree. ToastHost subscribes via useSyncExternalStore.
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Toast[] {
  return toasts;
}

export function pushToast(message: string, onRetry?: () => void): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, onRetry }];
  emit();
  return id;
}

export function dismissToast(id: number) {
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) {
    return;
  }
  toasts = next;
  emit();
}

export function clearToasts() {
  if (toasts.length === 0) {
    return;
  }
  toasts = [];
  emit();
}
