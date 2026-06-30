const queue: string[] = [];
let _abortFn: (() => void) | null = null;

export function pushInterrupt(msg: string): void {
  queue.push(msg);
}

export function popInterrupt(): string | undefined {
  return queue.shift();
}

export function hasInterrupt(): boolean {
  return queue.length > 0;
}

export function setAbortFn(fn: (() => void) | null): void {
  _abortFn = fn;
}

export function triggerAbort(): boolean {
  if (_abortFn) {
    _abortFn();
    return true;
  }
  return false;
}
