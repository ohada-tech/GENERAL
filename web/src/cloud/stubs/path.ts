export const join = (...p: string[]) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const resolve = join;
export const dirname = (p: string) => p.replace(/\/[^/]*$/, '') || '/';
export const basename = (p: string) => p.replace(/^.*\//, '');
export default { join, resolve, dirname, basename };
