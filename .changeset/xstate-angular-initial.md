---
'@zurab/xstate-angular': major
---

Initial release of `@zurab/xstate-angular`. Provides Angular bindings for XState v5 with a public API mirroring `@xstate/react` and `@xstate/solid`: `useMachine` / `useActor`, `useActorRef`, `fromActorRef`, `useSelector`. All return Angular `Signal`s and clean themselves up via `DestroyRef`.

Adds Angular dependency injection inside actor logic via:

- `fromPromiseInjectable` / `fromCallbackInjectable` / `fromObservableInjectable` — drop-in replacements for `fromPromise` / `fromCallback` / `fromObservable` whose creators run inside the registered `Injector`.
- `actionInjectable(fn)` — wrap an action so its body runs inside the injection context.
- `setupInjectable(factory)` — call a machine factory inside the injection context (use this for `inject(...)` in `context` / `guards`, where XState does not surface the actor system).
- `runInActorInjectionContext(system, fn)` — low-level escape hatch.

```ts
import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { useMachine, fromPromiseInjectable } from '@zurab/xstate-angular';
import { setup, assign } from 'xstate';
import { firstValueFrom } from 'rxjs';

const loadUsers = fromPromiseInjectable<User[]>(async () => {
  const http = inject(HttpClient);
  return firstValueFrom(http.get<User[]>('/api/users'));
});

const usersMachine = setup({
  actors: { loadUsers },
  actions: { setUsers: assign({ users: (_, p: { users: User[] }) => p.users }) }
}).createMachine({
  context: { users: [] as User[] },
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: 'loadUsers',
        onDone: {
          target: 'done',
          actions: {
            type: 'setUsers',
            params: ({ event }) => ({ users: event.output })
          }
        }
      }
    },
    done: {}
  }
});

@Component({
  standalone: true,
  template: `<ul>
    @for (u of users.snapshot().context.users; track u.id) {
      <li>{{ u.name }}</li>
    }
  </ul>`
})
export class UsersComponent {
  users = useMachine(usersMachine);
}
```

Requires `@angular/core@^19.0.0` and `xstate@^5`.
