# @zurab/xstate-angular

This package contains utilities for using [XState](https://github.com/statelyai/xstate) with [Angular](https://angular.dev) (v19+).

The public API mirrors `@xstate/react` and `@xstate/solid` — `useMachine`, `useActor`, `useActorRef`, `fromActorRef`, `useSelector` — so docs and patterns translate one-to-one across frameworks. All hooks return Angular `Signal`s and clean themselves up via `DestroyRef`.

## Quick start

1. Install the package alongside `xstate`:

```bash
npm i xstate @zurab/xstate-angular
```

2. Use a machine in a component:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { useMachine } from '@zurab/xstate-angular';
import { createMachine } from 'xstate';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } }
  }
});

@Component({
  standalone: true,
  selector: 'app-toggler',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button (click)="toggle.send({ type: 'TOGGLE' })">
      {{
        toggle.snapshot().value === 'inactive'
          ? 'Click to activate'
          : 'Active! Click to deactivate'
      }}
    </button>
  `
})
export class TogglerComponent {
  toggle = useMachine(toggleMachine);
}
```

## API

### `useMachine(logic, options?)` / `useActor(logic, options?)`

Creates and starts an actor for the lifetime of the surrounding Angular injection context, and returns an object with the snapshot signal, send function, and the actor reference.

```ts
const machine = useMachine(toggleMachine, { input: { /* ... */ } });

machine.snapshot();   // Signal<SnapshotFrom<typeof toggleMachine>>
machine.send({ ... }); // bound send
machine.actorRef;     // the underlying Actor<TLogic>
```

> Unlike React/Solid (which return `[snapshot, send, actorRef]`), Angular returns an object so it can be stored as a single class field.

### `useActorRef(logic, options?)`

Returns just the started actor — useful when you want to drive multiple `useSelector`s off it for granular change detection.

```ts
private door = useActorRef(doorMachine, { input: { doorId: 'door-42' } });

isLoading = useSelector(this.door, (s) => s.matches({ open: 'loadingUsers' }));
users     = useSelector(this.door, (s) => s.context.users);
```

### `fromActorRef(actorRef)`

Subscribes to an existing actor and returns a `Signal` of its current snapshot. Useful for spawned children or actors held by services.

```ts
const childSnap = fromActorRef(spawnedChild);
```

### `useSelector(actorRef, selector, compare?)`

Returns a derived `Signal`. Re-emits only when the selected value changes (default: `===`, override with the third argument).

```ts
const count = useSelector(this.actor, (s) => s.context.count);
const items = useSelector(
  this.actor,
  (s) => s.context.items,
  (a, b) => JSON.stringify(a) === JSON.stringify(b)
);
```

## Angular dependency injection inside actor logic

`useActorRef` (and therefore `useMachine`) registers the current `Injector` against the actor's `system`. Children that share the same system (invoked, spawned) inherit that registration automatically.

To consume Angular services from inside your machine, use the helpers below. Each one runs the user callback inside the registered injector so plain `inject(...)` works as in any Angular service.

### `fromPromiseInjectable(creator)` / `fromCallbackInjectable` / `fromObservableInjectable`

Drop-in replacements for `fromPromise` / `fromCallback` / `fromObservable` that wrap the creator with `runInActorInjectionContext`.

```ts
import { fromPromiseInjectable } from '@zurab/xstate-angular';
import { firstValueFrom } from 'rxjs';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

const loadUsers = fromPromiseInjectable<User[], { doorId: string }>(
  async ({ input }) => {
    const http = inject(HttpClient);
    return firstValueFrom(http.get<User[]>(`/api/doors/${input.doorId}/users`));
  }
);
```

### `actionInjectable(fn)`

Wraps an action so its body runs inside the Angular injection context.

```ts
const log = actionInjectable(({ context }) => {
  inject(LoggerService).log('count =', context.count);
});

setup({ actions: { log } }).createMachine({
  on: { PING: { actions: 'log' } }
});
```

### `setupInjectable(factory)`

Wraps a machine factory so it is called inside the Angular injection context. Use this when you need `inject(...)` in places XState does not surface `system` (notably the machine `context` factory and `guards`).

```ts
const machine = setupInjectable(() => {
  const auth = inject(AuthService);
  return setup({
    guards: { isAdmin: () => auth.role() === 'admin' }
  }).createMachine({
    context: () => ({ user: auth.user() })
  });
});

// in a component
private actor = useActorRef(machine);
```

The factory is invoked once per actor instance.

### `runInActorInjectionContext(system, fn)`

Low-level escape hatch — run any callback inside the registered injector for an actor's system. The injectable wrappers above are built on top of it.

```ts
runInActorInjectionContext(actor.system, () => {
  const svc = inject(MyService);
  // ...
});
```

## Recipes

### Fetcher pattern: a machine driven by an Angular service

The shortest end-to-end you'll likely need: an `@Injectable` service is the source of truth for data; the machine has a fetcher actor that calls it; the component just renders the snapshot. `REFRESH` re-pulls, `RETRY` recovers from `failed`. Verified by `src/fetcher.test.ts`.

```ts
// todo.api.ts
@Injectable({ providedIn: 'root' })
export class TodoApi {
  private store = [{ id: 1, title: 'Write docs', done: false }];
  shouldFail = false;

  async fetchAll(): Promise<Todo[]> {
    if (this.shouldFail) throw new Error('network down');
    return [...this.store];
  }

  add(title: string) {
    this.store.push({ id: this.store.length + 1, title, done: false });
  }
}
```

```ts
// todos.machine.ts
import { setup, assign } from 'xstate';
import { fromPromiseInjectable } from '@zurab/xstate-angular';
import { inject } from '@angular/core';
import { TodoApi } from './todo.api';

const fetchTodos = fromPromiseInjectable<Todo[]>(async () =>
  inject(TodoApi).fetchAll()
);

export const todosMachine = setup({
  types: {} as { context: { items: Todo[]; error: string | null } },
  actors: { fetchTodos },
  actions: {
    setItems: assign({ items: (_, p: { items: Todo[] }) => p.items }),
    setError: assign({ error: (_, p: { message: string }) => p.message }),
    clearError: assign({ error: null })
  }
}).createMachine({
  context: { items: [], error: null },
  initial: 'loading',
  states: {
    loading: {
      entry: 'clearError',
      invoke: {
        src: 'fetchTodos',
        onDone: {
          target: 'loaded',
          actions: {
            type: 'setItems',
            params: ({ event }) => ({ items: event.output })
          }
        },
        onError: {
          target: 'failed',
          actions: {
            type: 'setError',
            params: ({ event }) => ({ message: (event.error as Error).message })
          }
        }
      }
    },
    loaded: { on: { REFRESH: 'loading' } },
    failed: { on: { RETRY: 'loading' } }
  }
});
```

```ts
// todos.component.ts
@Component({
  standalone: true,
  selector: 'app-todos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = todos.snapshot();
    @switch (s.value) {
      @case ('loading') {
        <p>Loading…</p>
      }
      @case ('failed') {
        <p>Error: {{ s.context.error }}</p>
        <button (click)="todos.send({ type: 'RETRY' })">Retry</button>
      }
      @case ('loaded') {
        <ul>
          @for (t of s.context.items; track t.id) {
            <li>{{ t.title }}</li>
          }
        </ul>
        <button (click)="todos.send({ type: 'REFRESH' })">Refresh</button>
      }
    }
  `
})
export class TodosComponent {
  todos = useMachine(todosMachine);
}
```

What this guarantees (proved in `fetcher.test.ts`):

- Component mounts in `loading`, transitions to `loaded` with the items the service returned.
- Mutating the service (e.g. `api.add(...)`) and sending `REFRESH` re-fetches and the new items appear in the snapshot.
- A rejection from the service drives the machine to `failed`; `RETRY` brings it back to `loaded` once the failure is cleared.
- Two components mounted simultaneously share the same root-provided service and stay consistent (each refreshes on its own).

### HTTP requests with `HttpClient` and error handling

```ts
import { inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { fromPromiseInjectable } from '@zurab/xstate-angular';
import { firstValueFrom } from 'rxjs';
import { setup, assign } from 'xstate';

const loadUsers = fromPromiseInjectable<User[]>(async () =>
  firstValueFrom(inject(HttpClient).get<User[]>('/api/users'))
);

const machine = setup({
  types: {} as { context: { users: User[]; status: number | null } },
  actors: { loadUsers },
  actions: {
    setUsers: assign({ users: (_, p: { users: User[] }) => p.users }),
    setStatus: assign({ status: (_, p: { status: number }) => p.status })
  }
}).createMachine({
  context: { users: [], status: null },
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: 'loadUsers',
        onDone: {
          target: 'loaded',
          actions: {
            type: 'setUsers',
            params: ({ event }) => ({ users: event.output })
          }
        },
        onError: {
          target: 'failed',
          actions: {
            type: 'setStatus',
            params: ({ event }) => ({
              status: (event.error as HttpErrorResponse).status
            })
          }
        }
      }
    },
    loaded: {},
    failed: {}
  }
});
```

### Long-lived sources with `fromCallbackInjectable` (WebSocket)

```ts
import { inject } from '@angular/core';
import { fromCallbackInjectable } from '@zurab/xstate-angular';

const wsLogic = fromCallbackInjectable<{ type: 'MSG'; payload: unknown }>(
  ({ sendBack }) => {
    const socket = inject(WebSocketService).connect('/api/ws');
    const sub = socket.messages$.subscribe((payload) =>
      sendBack({ type: 'MSG', payload })
    );
    return () => sub.unsubscribe();
  }
);
```

### Streaming sources with `fromObservableInjectable`

```ts
import { inject } from '@angular/core';
import { fromObservableInjectable } from '@zurab/xstate-angular';

const ticks = fromObservableInjectable(
  () => inject(ClockService).oncePerSecond$
);
```

### Use a machine from a service

`useMachine` works in any Angular injection context — components, directives, pipes, or `@Injectable` services. From a service you typically use `runInInjectionContext` so the hook is anchored to the service's injector and the actor lives as long as the service.

```ts
import {
  Injectable,
  Injector,
  inject,
  runInInjectionContext
} from '@angular/core';
import { useMachine } from '@zurab/xstate-angular';

@Injectable({ providedIn: 'root' })
export class CounterFacade {
  private injector = inject(Injector);

  readonly api = runInInjectionContext(this.injector, () =>
    useMachine(counterMachine)
  );

  increment() {
    this.api.send({ type: 'inc' });
  }
}
```

### Persistence and rehydration

```ts
// Save
const persisted = facade.api.actorRef.getPersistedSnapshot();
localStorage.setItem('counter', JSON.stringify(persisted));

// Restore in a fresh component
@Component({ standalone: true, template: '' })
export class RestoredComponent {
  m = useMachine(counterMachine, {
    snapshot: JSON.parse(localStorage.getItem('counter') ?? 'null') ?? undefined
  });
}
```

### Share an actor between sibling components

Provide the actor via an `InjectionToken` on the parent. Children just `inject(...)` it and read the slices they need with `useSelector`.

```ts
import { Component, InjectionToken, inject } from '@angular/core';
import { Actor } from 'xstate';
import { useActorRef, useSelector } from '@zurab/xstate-angular';
import { counterMachine } from './counter.machine';

const COUNTER = new InjectionToken<Actor<typeof counterMachine>>('COUNTER');

@Component({
  standalone: true,
  selector: 'app-counter-display',
  template: `<span>{{ count() }}</span>`
})
export class CounterDisplayComponent {
  count = useSelector(inject(COUNTER), (s) => s.context.count);
}

@Component({
  standalone: true,
  selector: 'app-counter-host',
  imports: [CounterDisplayComponent],
  providers: [
    { provide: COUNTER, useFactory: () => useActorRef(counterMachine) }
  ],
  template: `
    <button (click)="actor.send({ type: 'inc' })">+</button>
    <app-counter-display />
    <app-counter-display />
  `
})
export class CounterHostComponent {
  actor = inject(COUNTER);
}
```

### Spawned child actors

```ts
@Component({ ... })
export class HostComponent {
  parent = useActorRef(parentMachine);
  childRef = this.parent.getSnapshot().context.child;
  childSnap = fromActorRef(this.childRef);
}
```

## End-to-end example: a door that loads people behind it

```ts
// users-api.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface User {
  id: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private http = inject(HttpClient);
  getUsersBehindDoor(doorId: string) {
    return firstValueFrom(this.http.get<User[]>(`/api/doors/${doorId}/users`));
  }
}
```

```ts
// door.machine.ts
import { setup, assign } from 'xstate';
import { fromPromiseInjectable } from '@zurab/xstate-angular';
import { inject } from '@angular/core';
import { UsersApiService, type User } from './users-api.service';

const loadUsersBehindDoor = fromPromiseInjectable<User[], { doorId: string }>(
  ({ input }) => inject(UsersApiService).getUsersBehindDoor(input.doorId)
);

export const doorMachine = setup({
  types: {
    context: {} as { doorId: string; users: User[]; error: string | null },
    events: {} as { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'RETRY' },
    input: {} as { doorId: string }
  },
  actors: { loadUsersBehindDoor },
  actions: {
    setUsers: assign({ users: (_, p: { users: User[] }) => p.users }),
    clearUsers: assign({ users: [], error: null }),
    setError: assign({ error: (_, p: { message: string }) => p.message })
  }
}).createMachine({
  context: ({ input }) => ({ doorId: input.doorId, users: [], error: null }),
  initial: 'closed',
  states: {
    closed: {
      entry: { type: 'clearUsers' },
      on: { OPEN: 'open' }
    },
    open: {
      initial: 'loading',
      on: { CLOSE: 'closed' },
      states: {
        loading: {
          invoke: {
            src: 'loadUsersBehindDoor',
            input: ({ context }) => ({ doorId: context.doorId }),
            onDone: {
              target: 'idle',
              actions: {
                type: 'setUsers',
                params: ({ event }) => ({ users: event.output })
              }
            },
            onError: {
              target: 'failed',
              actions: {
                type: 'setError',
                params: ({ event }) => ({ message: String(event.error) })
              }
            }
          }
        },
        idle: {},
        failed: { on: { RETRY: 'loading' } }
      }
    }
  }
});
```

```ts
// door.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { useMachine } from '@zurab/xstate-angular';
import { doorMachine } from './door.machine';

@Component({
  standalone: true,
  selector: 'app-door',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = door.snapshot();
    <h2>Door [{{ s.value }}]</h2>

    @if (s.matches('closed')) {
      <button (click)="door.send({ type: 'OPEN' })">Open</button>
    } @else {
      <button (click)="door.send({ type: 'CLOSE' })">Close</button>

      @if (s.matches({ open: 'loading' })) {
        <p>Loading…</p>
      } @else if (s.context.error; as err) {
        <p>Failed: {{ err }}</p>
        <button (click)="door.send({ type: 'RETRY' })">Retry</button>
      } @else {
        <ul>
          @for (u of s.context.users; track u.id) {
            <li>{{ u.name }}</li>
          } @empty {
            <li><i>No one is behind the door.</i></li>
          }
        </ul>
      }
    }
  `
})
export class DoorComponent {
  protected door = useMachine(doorMachine, { input: { doorId: 'door-42' } });
}
```

## Constraints to be aware of

- **Context factory and guards do not receive `system`.** XState's public API does not surface the actor system to the machine `context: ({ input, spawn, self }) => ...` factory or to guard predicates. Use `setupInjectable` (factory captures `inject(...)` in a closure) or pre-inject services through `ActorOptions.input`.
- **Zoneless change detection** (`provideExperimentalZonelessChangeDetection`) is supported. UI must read state through `useMachine`/`useSelector`/`fromActorRef` so signal updates trigger change detection. Side effects in `fromCallback` that mutate non-signal properties will not refresh the view in zoneless mode.
- **Auto-patching is intentionally avoided.** No global hooks rewrite `actionExecutor` or similar. If you want DI in a custom action, opt in explicitly with `actionInjectable` or `runInActorInjectionContext`.
