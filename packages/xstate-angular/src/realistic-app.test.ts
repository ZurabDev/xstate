/**
 * End-to-end style integration tests that exercise the package the way a real
 * Angular application would: real components, real change detection, real
 * `provideHttpClient()` + `HttpTestingController`, real `Injectable({
 * providedIn: 'root' })` services, real OnPush, real DOM rendering through
 * jsdom.
 *
 * Counterpart to `index.test.ts`, which is more unit-level. The tests here
 * deliberately avoid mocking the Angular infrastructure to give a strong
 * guarantee that the package will behave the same way inside `ng test` / `ng
 * build` of a downstream consumer app.
 */
import { describe, expect, it } from 'vitest';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  Injector,
  inject,
  runInInjectionContext
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom, of } from 'rxjs';
import { assign, createActor, setup } from 'xstate';
import {
  fromCallbackInjectable,
  fromObservableInjectable,
  fromPromiseInjectable,
  setupInjectable,
  useActorRef,
  useMachine,
  useSelector
} from './index';

interface User {
  id: string;
  name: string;
}

describe('@zurab/xstate-angular — real Angular integration', () => {
  describe('HttpClient via provideHttpClient + HttpTestingController', () => {
    it('loads users via real HttpClient inside fromPromiseInjectable', async () => {
      @Injectable({ providedIn: 'root' })
      class UsersApi {
        private http = inject(HttpClient);
        load() {
          return firstValueFrom(this.http.get<User[]>('/api/users'));
        }
      }

      const loadUsers = fromPromiseInjectable<User[]>(async () =>
        inject(UsersApi).load()
      );

      const machine = setup({
        types: {} as { context: { users: User[] } },
        actors: { loadUsers },
        actions: {
          setUsers: assign({
            users: (_, params: { users: User[] }) => params.users
          })
        }
      }).createMachine({
        context: { users: [] },
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
        selector: 'http-host',
        template: ''
      })
      class HostComponent {
        machine = useMachine(machine);
      }

      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const httpController = TestBed.inject(HttpTestingController);
      const req = httpController.expectOne('/api/users');
      expect(req.request.method).toBe('GET');
      req.flush([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]);

      // Flush the promise resolution chain
      await Promise.resolve();
      await Promise.resolve();

      const snap = fixture.componentInstance.machine.snapshot();
      expect(snap.value).toBe('done');
      expect(snap.context.users).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]);

      httpController.verify();
    });

    it('propagates HTTP errors to onError', async () => {
      const failing = fromPromiseInjectable<unknown>(async () =>
        firstValueFrom(inject(HttpClient).get('/api/broken'))
      );

      const machine = setup({
        types: {} as { context: { status: number | null } },
        actors: { failing },
        actions: {
          setStatus: assign({
            status: (_, params: { status: number }) => params.status
          })
        }
      }).createMachine({
        context: { status: null },
        initial: 'loading',
        states: {
          loading: {
            invoke: {
              src: 'failing',
              onError: {
                target: 'failed',
                actions: {
                  type: 'setStatus',
                  params: ({ event }) => ({
                    status: (event.error as { status?: number }).status ?? -1
                  })
                }
              }
            }
          },
          failed: {}
        }
      });

      @Component({
        standalone: true,
        selector: 'http-error-host',
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const ctrl = TestBed.inject(HttpTestingController);
      ctrl.expectOne('/api/broken').flush('boom', {
        status: 500,
        statusText: 'Server Error'
      });

      await Promise.resolve();
      await Promise.resolve();

      const snap = fixture.componentInstance.m.snapshot();
      expect(snap.value).toBe('failed');
      expect(snap.context.status).toBe(500);
      ctrl.verify();
    });
  });

  describe('OnPush + signals', () => {
    it('updates the rendered DOM via signal-driven CD', () => {
      const machine = setup({
        types: {} as { context: { count: number } }
      }).createMachine({
        context: { count: 0 },
        on: {
          inc: {
            actions: assign({ count: ({ context }) => context.count + 1 })
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'app-onpush',
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `
          <p id="c">{{ m.snapshot().context.count }}</p>
          <button id="b" (click)="m.send({ type: 'inc' })">+</button>
        `
      })
      class OnPushComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(OnPushComponent);
      fixture.detectChanges();

      const cEl = () =>
        fixture.debugElement.query(By.css('#c')).nativeElement.textContent;
      expect(cEl()).toBe('0');

      fixture.debugElement
        .query(By.css('#b'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(cEl()).toBe('1');

      fixture.debugElement
        .query(By.css('#b'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(cEl()).toBe('2');
    });
  });

  describe('use from a service via runInInjectionContext', () => {
    it('useMachine works inside a singleton service', () => {
      const machine = setup({
        types: {} as { context: { count: number } }
      }).createMachine({
        context: { count: 0 },
        on: {
          inc: {
            actions: assign({ count: ({ context }) => context.count + 1 })
          }
        }
      });

      @Injectable({ providedIn: 'root' })
      class CounterFacade {
        private injector = inject(Injector);

        readonly api = runInInjectionContext(this.injector, () =>
          useMachine(machine)
        );

        increment() {
          this.api.send({ type: 'inc' });
        }
      }

      const facade = TestBed.inject(CounterFacade);
      expect(facade.api.snapshot().context.count).toBe(0);
      facade.increment();
      facade.increment();
      expect(facade.api.snapshot().context.count).toBe(2);
    });
  });

  describe('assertInInjectionContext guards', () => {
    const machine = setup({}).createMachine({});

    it('useMachine throws outside an Angular injection context', () => {
      expect(() => useMachine(machine)).toThrow();
    });

    it('useActorRef throws outside an Angular injection context', () => {
      expect(() => useActorRef(machine)).toThrow();
    });

    it('useSelector throws outside an Angular injection context', () => {
      const a = createActor(machine);
      a.start();
      expect(() => useSelector(a, (s) => s)).toThrow();
      a.stop();
    });
  });

  describe('fromCallbackInjectable', () => {
    it('runs the callback inside Angular injection context', () => {
      @Injectable({ providedIn: 'root' })
      class ClockSvc {
        readonly now = () => 1234;
      }

      let observedNow = 0;
      const ticker = fromCallbackInjectable<{ type: 'TICK' }>(
        ({ sendBack }) => {
          observedNow = inject(ClockSvc).now();
          sendBack({ type: 'TICK' });
          return () => undefined;
        }
      );

      const machine = setup({
        types: {} as { context: { tick: number } },
        actors: { ticker },
        actions: {
          bump: assign({ tick: ({ context }) => context.tick + 1 })
        }
      }).createMachine({
        context: { tick: 0 },
        invoke: { src: 'ticker' },
        on: { TICK: { actions: 'bump' } }
      });

      @Component({
        standalone: true,
        selector: 'cb-host',
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      expect(observedNow).toBe(1234);
      expect(fixture.componentInstance.actor.getSnapshot().context.tick).toBe(
        1
      );
    });
  });

  describe('fromObservableInjectable', () => {
    it('runs the observable creator inside Angular injection context', () => {
      @Injectable({ providedIn: 'root' })
      class StreamSvc {
        readonly token = 'abc';
      }

      let captured = '';
      const stream = fromObservableInjectable(() => {
        captured = inject(StreamSvc).token;
        return of(0);
      });

      const machine = setup({
        actors: { stream }
      }).createMachine({
        invoke: { src: 'stream' }
      });

      @Component({
        standalone: true,
        selector: 'obs-host',
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      expect(captured).toBe('abc');
      expect(fixture.componentInstance.actor.getSnapshot().status).toBe(
        'active'
      );
    });
  });

  describe('setupInjectable + guards', () => {
    it('guards can read inject() results captured at machine creation', () => {
      @Injectable({ providedIn: 'root' })
      class FlagSvc {
        canGo = false;
      }

      const factory = setupInjectable(() => {
        const flags = inject(FlagSvc);
        return setup({
          guards: { allow: () => flags.canGo }
        }).createMachine({
          initial: 'idle',
          states: {
            idle: {
              on: { GO: { target: 'go', guard: 'allow' } }
            },
            go: {}
          }
        });
      });

      @Component({
        standalone: true,
        selector: 'guard-host',
        template: ''
      })
      class HostComponent {
        actor = useActorRef(factory);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const actor = fixture.componentInstance.actor;
      const flags = TestBed.inject(FlagSvc);

      // Guard returns false — transition should be blocked.
      actor.send({ type: 'GO' });
      expect(actor.getSnapshot().value).toBe('idle');

      // Service is captured by reference; flipping the flag changes the guard.
      flags.canGo = true;
      actor.send({ type: 'GO' });
      expect(actor.getSnapshot().value).toBe('go');
    });
  });

  describe('delayed transitions', () => {
    it('after: works in a real Angular component', async () => {
      const machine = setup({}).createMachine({
        initial: 'a',
        states: {
          a: { after: { 10: 'b' } },
          b: {}
        }
      });

      @Component({
        standalone: true,
        selector: 'after-host',
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.actor.getSnapshot().value).toBe('a');

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(fixture.componentInstance.actor.getSnapshot().value).toBe('b');
    });
  });

  describe('lifecycle: actor stops on component destroy', () => {
    it('stops the actor and unsubscribes selectors when the component is destroyed', () => {
      const machine = setup({
        types: {} as { context: { count: number } }
      }).createMachine({
        context: { count: 0 },
        on: {
          inc: {
            actions: assign({ count: ({ context }) => context.count + 1 })
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'lifecycle-host',
        template: ``
      })
      class HostComponent {
        actor = useActorRef(machine);
        count = useSelector(this.actor, (s) => s.context.count);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const actor = fixture.componentInstance.actor;

      actor.send({ type: 'inc' });
      expect(actor.getSnapshot().status).toBe('active');

      fixture.destroy();

      expect(actor.getSnapshot().status).toBe('stopped');
      // Sending after stop is a no-op; status stays 'stopped'.
      actor.send({ type: 'inc' });
      expect(actor.getSnapshot().status).toBe('stopped');
    });
  });
});
