import { type Signal, assertInInjectionContext } from '@angular/core';
import type { Actor, ActorOptions, AnyActorLogic, SnapshotFrom } from 'xstate';
import { fromActorRef } from './fromActorRef';
import { useActorRef } from './useActorRef';

export interface UseMachineResult<TLogic extends AnyActorLogic> {
  snapshot: Signal<SnapshotFrom<TLogic>>;
  send: Actor<TLogic>['send'];
  actorRef: Actor<TLogic>;
}

/**
 * Creates and starts an XState actor for the lifetime of the surrounding
 * Angular injection context, and returns its snapshot signal, send function,
 * and actor reference.
 *
 * Mirrors `useMachine` from `@xstate/react` and `@xstate/solid` so the public
 * surface translates one-to-one across frameworks. The returned shape is an
 * object (not a tuple) for ergonomic use as a single class field.
 *
 * @example
 *
 * ```ts
 * @Component({
 *   template: `
 *     <button (click)="toggle.send({ type: 'TOGGLE' })">
 *       {{ toggle.snapshot().value }}
 *     </button>
 *   `
 * })
 * export class TogglerComponent {
 *   toggle = useMachine(toggleMachine);
 * }
 * ```
 */
export function useMachine<TLogic extends AnyActorLogic>(
  logic: TLogic | (() => TLogic),
  options?: ActorOptions<TLogic>
): UseMachineResult<TLogic> {
  assertInInjectionContext(useMachine);
  const actorRef = useActorRef(logic, options);
  const snapshot = fromActorRef(actorRef) as Signal<SnapshotFrom<TLogic>>;
  return {
    snapshot,
    send: actorRef.send.bind(actorRef),
    actorRef
  };
}

/** Alias of {@link useMachine}, mirroring `useActor` from `@xstate/solid`. */
export const useActor = useMachine;
