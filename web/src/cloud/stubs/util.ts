export const promisify =
  <T extends (...a: any[]) => any>(fn: T) =>
  (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      try {
        fn(...args, (err: unknown, out: unknown) => (err ? reject(err) : resolve(out)));
      } catch (e) {
        reject(e);
      }
    });
export default { promisify };
