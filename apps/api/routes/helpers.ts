export function ok<T>(data: T) {
  return { success: true as const, data };
}
