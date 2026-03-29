import type { InteractionManagerBaseOptions } from '../managers/InteractionManager';

// Token metadata is only needed when token-level interactions are enabled.
export function shouldUseTokenTransformer<TMode extends 'file' | 'diff'>(
  options: InteractionManagerBaseOptions<TMode> & {
    useTokenTransformer?: boolean;
  }
): boolean {
  return (
    options.useTokenTransformer === true ||
    options.onTokenClick != null ||
    options.onTokenEnter != null ||
    options.onTokenLeave != null
  );
}
