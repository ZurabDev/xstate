import type { AnyActorLogic } from 'xstate';

/**
 * Marks a machine factory so that {@link useActorRef} / {@link useMachine} invoke
 * it inside the current Angular injection context. Use this when you need
 * `inject(...)` calls inside `setup({...})` or `createMachine({...})`'s
 * `context`/`guards` configuration — places that the XState API does not
 * surface the actor `system` to.
 *
 * @example
 *
 * ```ts
 * const machine = setupInjectable(() => {
 *   const auth = inject(AuthService);
 *   return setup({
 *     guards: { isAdmin: () => auth.role() === 'admin' }
 *   }).createMachine({
 *     context: () => ({ user: auth.user() })
 *   });
 * });
 *
 * // in component
 * private actor = useActorRef(machine);
 * ```
 *
 * The factory is called once per actor instance, so each component receives a
 * machine wired to its own DI scope.
 */
export function setupInjectable<TLogic extends AnyActorLogic>(
  factory: () => TLogic
): () => TLogic {
  return factory;
}
