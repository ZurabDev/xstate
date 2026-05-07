import {
  DestroyRef,
  Injector,
  type Signal,
  assertInInjectionContext,
  inject,
  linkedSignal,
  runInInjectionContext
} from '@angular/core';
import type { AnyActorRef, SnapshotFrom } from 'xstate';

function defaultCompare<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * Returns a readonly Angular `Signal` of a value derived from the actor's
 * snapshot. Re-emits only when the selected value changes according to
 * `compare` (default: strict equality).
 *
 * @example
 *
 * ```ts
 * const count = useSelector(actor, (s) => s.context.count);
 * ```
 */
export function useSelector<TActor extends AnyActorRef, TSelected>(
  actorRef: TActor,
  selector: (snapshot: SnapshotFrom<TActor>) => TSelected,
  compare: (a: TSelected, b: TSelected) => boolean = defaultCompare
): Signal<TSelected> {
  assertInInjectionContext(useSelector);
  const injector = inject(Injector);

  return runInInjectionContext(injector, () => {
    const destroyRef = inject(DestroyRef);
    const slice = linkedSignal(
      () => selector(actorRef.getSnapshot() as SnapshotFrom<TActor>),
      { equal: compare }
    );

    const sub = actorRef.subscribe((s) => {
      slice.set(selector(s as SnapshotFrom<TActor>));
    });

    destroyRef.onDestroy(() => {
      sub.unsubscribe();
    });

    return slice.asReadonly();
  });
}
