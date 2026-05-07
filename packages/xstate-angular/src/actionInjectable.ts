import type {
  ActionArgs,
  EventObject,
  MachineContext,
  ParameterizedObject
} from 'xstate';
import { runInActorInjectionContext } from './injectorRegistry';

/**
 * Wrap an XState action function so it executes inside the Angular injection
 * context registered for the actor system. Use when you want to call
 * `inject(...)` from inside an action body.
 *
 * @example
 *
 * ```ts
 * const logger = actionInjectable(
 *   ({ context }, params: { message: string }) => {
 *     inject(LoggerService).log(params.message, context);
 *   }
 * );
 *
 * setup({ actions: { logger } }).createMachine({
 *   entry: { type: 'logger', params: { message: 'started' } }
 * });
 * ```
 */
export function actionInjectable<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined = undefined
>(
  fn: (
    args: ActionArgs<TContext, TExpressionEvent, TEvent>,
    params: TParams
  ) => void
) {
  return (
    args: ActionArgs<TContext, TExpressionEvent, TEvent>,
    params: TParams
  ): void => {
    runInActorInjectionContext(args.system, () => fn(args, params));
  };
}
