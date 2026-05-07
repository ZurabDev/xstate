import {
  fromCallback,
  fromObservable,
  fromPromise,
  type EventObject,
  type NonReducibleUnknown
} from 'xstate';
import { runInActorInjectionContext } from './injectorRegistry';

/**
 * Drop-in replacement for {@link fromPromise} that runs the creator inside the
 * Angular injection context registered for the actor system. Inside the
 * callback you can call `inject(MyService)` directly as in any other Angular
 * function.
 *
 * @example
 *
 * ```ts
 * const loadUsers = fromPromiseInjectable(async () => {
 *   const http = inject(HttpClient);
 *   return firstValueFrom(http.get<User[]>('/api/users'));
 * });
 * ```
 */
export function fromPromiseInjectable<
  TOutput,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject
>(creator: Parameters<typeof fromPromise<TOutput, TInput, TEmitted>>[0]) {
  return fromPromise<TOutput, TInput, TEmitted>((args) =>
    runInActorInjectionContext(args.system, () => creator(args))
  );
}

/**
 * Drop-in replacement for {@link fromCallback} that runs the callback inside the
 * Angular injection context.
 */
export function fromCallbackInjectable<
  TEvent extends EventObject,
  TInput = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject
>(callback: Parameters<typeof fromCallback<TEvent, TInput, TEmitted>>[0]) {
  return fromCallback<TEvent, TInput, TEmitted>((args) =>
    runInActorInjectionContext(args.system, () => callback(args))
  );
}

/**
 * Drop-in replacement for {@link fromObservable} that runs the observable
 * creator inside the Angular injection context.
 */
export function fromObservableInjectable<
  TContext,
  TInput extends NonReducibleUnknown = NonReducibleUnknown,
  TEmitted extends EventObject = EventObject
>(creator: Parameters<typeof fromObservable<TContext, TInput, TEmitted>>[0]) {
  return fromObservable<TContext, TInput, TEmitted>((args) =>
    runInActorInjectionContext(args.system, () => creator(args))
  );
}
