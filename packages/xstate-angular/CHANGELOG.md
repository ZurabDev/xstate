# @zurab/xstate-angular

## 1.0.1

### Patch Changes

- Point `homepage`, `repository.url`, and `bugs.url` at the actual fork (`ZurabDev/xstate`) so npmjs.com renders the README and links to the correct source.

## 1.0.0

### Major Changes

Initial release of `@zurab/xstate-angular`.

Angular 19+ bindings for XState v5 with a public API that mirrors `@xstate/react` and `@xstate/solid` so docs and examples translate one-to-one across frameworks.

#### What's included

**Hooks** (each callable in any Angular injection context — components, directives, pipes, services):

- `useMachine(logic, options?)` / `useActor(logic, options?)` — start an actor for the lifetime of the surrounding context. Returns `{ snapshot: Signal<…>, send, actorRef }`.
- `useActorRef(logic, options?)` — start an actor and return only the `Actor<TLogic>` reference; use with `useSelector` for granular change detection.
- `fromActorRef(actorRef)` — `Signal<SnapshotFrom<…>>` for an externally created actor (e.g. spawned children).
- `useSelector(actorRef, selector, equal?)` — derived `Signal<TSelected>` that re-emits only when the selected slice changes.

**Angular DI inside actor logic:**

- `fromPromiseInjectable(creator)` — drop-in for `fromPromise` whose creator runs inside the registered Angular `Injector`. Use `inject(HttpClient)`, `inject(MyService)` directly.
- `fromCallbackInjectable(callback)` — same for `fromCallback`.
- `fromObservableInjectable(creator)` — same for `fromObservable`.
- `actionInjectable(fn)` — wrap an action so its body runs in the injection context.
- `setupInjectable(factory)` — call a machine factory in the injection context. Use this when you need `inject(...)` in `context: () => …` or `guards`, where XState does not surface the actor `system`.
- `runInActorInjectionContext(system, fn)` — low-level escape hatch for custom integrations.

#### Architecture

The injector is held in a `WeakMap<ActorSystem, Injector>` keyed by the actor's system. Every spawned/invoked descendant of a root actor shares the same `system` reference, so DI propagates through the actor tree automatically. The package adds **zero changes to XState core** — it only registers the injector before the actor's `start()` and unsubscribes via `DestroyRef`.

#### Verified scenarios (57 tests across 5 files)

- Reactive snapshot signal, `send` triggers updates, `DestroyRef.onDestroy` stops the actor.
- `useSelector` re-renders only on slice change; supports custom comparator.
- `fromActorRef` for external/spawned actors.
- `fromPromiseInjectable` resolving HTTP via real `HttpClient` + `HttpTestingController` (success and `onError`).
- Component-private DI: actor sees the same `inject(…)` instance the component reads (strict identity check).
- Two simultaneous components with different `providers` resolve to their own values.
- Hierarchical providers: ancestor token visible to descendant; closest-wins.
- Multi-token resolution, root-vs-component shadowing, optional injection, chained services.
- Stateful service mutation observed both ways.
- `setupInjectable` for guards and `context` factories.
- Persistence/rehydration through `getPersistedSnapshot()` + `{ snapshot }`.
- Spawned children via `fromActorRef`, parent-provides-actor-to-child via `InjectionToken` + `useFactory`.
- OnPush change detection, delayed transitions (`after:`), service-level `useMachine` via `runInInjectionContext`, `assertInInjectionContext` enforcement.
- Fetcher pattern with mocked Angular service: initial load, REFRESH, FAILED + RETRY recovery, two-component consistency.

#### Compatibility

- `@angular/core` `^19.0.0`
- `xstate` `^5`

#### Known constraints

- `context: ({ input, spawn, self }) => …` and guards do not receive `system` from XState's public API. Use `setupInjectable` (factory captures `inject(…)` in a closure) or pre-inject services through `ActorOptions.input`.
- Tests use `jsdom` (matches `@xstate/store-angular`'s setup); for browser-runtime smoke tests, run inside a downstream `ng test` Karma/Playwright config.
