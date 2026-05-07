import { describe, expect, it, vi } from 'vitest';
import { Component, Injectable, Injector, effect, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { assign, createActor, createMachine, setup } from 'xstate';
import {
  actionInjectable,
  createMachine as reExportedCreateMachine,
  fromActorRef,
  fromPromiseInjectable,
  runInActorInjectionContext,
  setupInjectable,
  useActor,
  useActorRef,
  useMachine,
  useSelector
} from './index';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'inactive',
  context: { count: 0 },
  states: {
    inactive: {
      on: { TOGGLE: 'active' }
    },
    active: {
      entry: assign({ count: ({ context }) => context.count + 1 }),
      on: { TOGGLE: 'inactive' }
    }
  }
});

describe('@zurab/xstate-angular', () => {
  describe('useMachine', () => {
    it('exposes a reactive snapshot signal', () => {
      @Component({
        standalone: true,
        template: `<p id="v">{{ machine.snapshot().value }}</p>`
      })
      class HostComponent {
        machine = useMachine(toggleMachine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      const el = fixture.debugElement.query(By.css('#v')).nativeElement;
      expect(el.textContent).toBe('inactive');
    });

    it('updates the snapshot signal when send() is called', () => {
      @Component({
        standalone: true,
        template: `
          <p id="v">{{ machine.snapshot().value }}</p>
          <p id="c">{{ machine.snapshot().context.count }}</p>
          <button id="t" (click)="toggle()">toggle</button>
        `
      })
      class HostComponent {
        machine = useMachine(toggleMachine);
        toggle() {
          this.machine.send({ type: 'TOGGLE' });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const debugEl = fixture.debugElement;

      expect(debugEl.query(By.css('#v')).nativeElement.textContent).toBe(
        'inactive'
      );

      debugEl.query(By.css('#t')).triggerEventHandler('click', null);
      fixture.detectChanges();

      expect(debugEl.query(By.css('#v')).nativeElement.textContent).toBe(
        'active'
      );
      expect(debugEl.query(By.css('#c')).nativeElement.textContent).toBe('1');
    });

    it('exposes the underlying actorRef', () => {
      @Component({ standalone: true, template: '' })
      class HostComponent {
        machine = useMachine(toggleMachine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.machine.actorRef).toBeDefined();
      expect(typeof fixture.componentInstance.machine.actorRef.send).toBe(
        'function'
      );
    });

    it('stops the actor when the component is destroyed', () => {
      @Component({ standalone: true, template: '' })
      class HostComponent {
        machine = useMachine(toggleMachine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const actor = fixture.componentInstance.machine.actorRef;
      const stopSpy = vi.spyOn(actor, 'stop');

      fixture.destroy();
      expect(stopSpy).toHaveBeenCalled();
    });

    it('useActor is an alias of useMachine', () => {
      expect(useActor).toBe(useMachine);
    });
  });

  describe('useActorRef', () => {
    it('returns a started actor', () => {
      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(toggleMachine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const snap = fixture.componentInstance.actor.getSnapshot();
      expect(snap.value).toBe('inactive');
    });

    it('passes input through ActorOptions', () => {
      const inputMachine = setup({
        types: {} as { input: { initial: number } }
      }).createMachine({
        context: ({ input }) => ({ count: input.initial })
      });

      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(inputMachine, { input: { initial: 42 } });
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.actor.getSnapshot().context.count).toBe(
        42
      );
    });

    it('invokes a factory function in the Angular injection context', () => {
      @Injectable({ providedIn: 'root' })
      class CounterService {
        readonly initial = 7;
      }

      const factory = setupInjectable(() => {
        const svc = inject(CounterService);
        return setup({}).createMachine({
          context: { count: svc.initial }
        });
      });

      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(factory);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.actor.getSnapshot().context.count).toBe(
        7
      );
    });
  });

  describe('useSelector', () => {
    it('returns a signal of the selected slice', () => {
      @Component({
        standalone: true,
        template: `<p id="c">{{ count() }}</p>`
      })
      class HostComponent {
        actor = useActorRef(toggleMachine);
        count = useSelector(this.actor, (s) => s.context.count);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const el = fixture.debugElement.query(By.css('#c')).nativeElement;
      expect(el.textContent).toBe('0');
    });

    it('only re-runs effects when the selected value changes', () => {
      const counterMachine = setup({}).createMachine({
        context: { count: 0, other: 0 },
        on: {
          INC_COUNT: {
            actions: assign({ count: ({ context }) => context.count + 1 })
          },
          INC_OTHER: {
            actions: assign({ other: ({ context }) => context.other + 1 })
          }
        }
      });

      let effectCount = 0;

      @Component({
        standalone: true,
        template: `
          <p id="c">{{ count() }}</p>
          <button id="ic" (click)="actor.send({ type: 'INC_COUNT' })">
            +c
          </button>
          <button id="io" (click)="actor.send({ type: 'INC_OTHER' })">
            +o
          </button>
        `
      })
      class HostComponent {
        actor = useActorRef(counterMachine);
        count = useSelector(this.actor, (s) => s.context.count);

        constructor() {
          effect(() => {
            // touch the signal to subscribe
            void this.count();
            effectCount++;
          });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(effectCount).toBe(1);

      fixture.debugElement
        .query(By.css('#io'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(effectCount).toBe(1);

      fixture.debugElement
        .query(By.css('#ic'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(effectCount).toBe(2);
    });

    it('respects a custom comparator', () => {
      const arrayMachine = setup({}).createMachine({
        context: { items: [1, 2] as number[] },
        on: {
          SAME: { actions: assign({ items: () => [1, 2] }) },
          DIFFERENT: { actions: assign({ items: () => [3, 4] }) }
        }
      });

      let effectCount = 0;

      @Component({
        standalone: true,
        template: `<p>{{ items() }}</p>`
      })
      class HostComponent {
        actor = useActorRef(arrayMachine);
        items = useSelector(
          this.actor,
          (s) => s.context.items,
          (a, b) => JSON.stringify(a) === JSON.stringify(b)
        );
        constructor() {
          effect(() => {
            void this.items();
            effectCount++;
          });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(effectCount).toBe(1);

      fixture.componentInstance.actor.send({ type: 'SAME' });
      fixture.detectChanges();
      expect(effectCount).toBe(1);

      fixture.componentInstance.actor.send({ type: 'DIFFERENT' });
      fixture.detectChanges();
      expect(effectCount).toBe(2);
    });
  });

  describe('fromActorRef', () => {
    it('returns a snapshot signal for an externally created actor', () => {
      const external = createActor(toggleMachine);
      external.start();

      @Component({
        standalone: true,
        template: `<p id="v">{{ snap().value }}</p>`
      })
      class HostComponent {
        snap = fromActorRef(external);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('#v')).nativeElement.textContent
      ).toBe('inactive');

      external.send({ type: 'TOGGLE' });
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('#v')).nativeElement.textContent
      ).toBe('active');

      external.stop();
    });
  });

  describe('fromPromiseInjectable', () => {
    it('resolves through Angular DI inside the promise creator', async () => {
      @Injectable({ providedIn: 'root' })
      class UsersApi {
        load(): Promise<string[]> {
          return Promise.resolve(['Alice', 'Bob']);
        }
      }

      const loadUsers = fromPromiseInjectable<string[]>(async () => {
        const api = inject(UsersApi);
        return api.load();
      });

      const machine = setup({
        types: {} as {
          context: { users: string[] };
          events: { type: 'LOAD' };
        },
        actors: { loadUsers },
        actions: {
          setUsers: assign({
            users: (_, params: { users: string[] }) => params.users
          })
        }
      }).createMachine({
        context: { users: [] },
        initial: 'idle',
        states: {
          idle: { on: { LOAD: 'loading' } },
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

      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const actor = fixture.componentInstance.actor;
      actor.send({ type: 'LOAD' });

      // Allow microtasks to flush
      await Promise.resolve();
      await Promise.resolve();

      const snap = actor.getSnapshot();
      expect(snap.value).toBe('done');
      expect(snap.context.users).toEqual(['Alice', 'Bob']);
    });

    it('child invoked actor inherits the same injector via system propagation', async () => {
      @Injectable({ providedIn: 'root' })
      class TokenSvc {
        token() {
          return 'secret';
        }
      }

      const child = fromPromiseInjectable<string>(async () => {
        return inject(TokenSvc).token();
      });

      const parent = setup({
        types: {} as { context: { token: string | null } },
        actors: { child },
        actions: {
          setToken: assign({
            token: (_, params: { token: string }) => params.token
          })
        }
      }).createMachine({
        context: { token: null },
        invoke: {
          src: 'child',
          onDone: {
            actions: {
              type: 'setToken',
              params: ({ event }) => ({ token: event.output })
            }
          }
        }
      });

      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(parent);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.actor.getSnapshot().context.token).toBe(
        'secret'
      );
    });
  });

  describe('actionInjectable', () => {
    it('runs the action body inside the Angular injection context', () => {
      @Injectable({ providedIn: 'root' })
      class Audit {
        readonly events: string[] = [];
        push(s: string) {
          this.events.push(s);
        }
      }

      const log = actionInjectable<
        { count: number },
        { type: 'PING' },
        { type: 'PING' }
      >(({ context }) => {
        inject(Audit).push(`count=${context.count}`);
      });

      const machine = setup({
        types: {} as {
          context: { count: number };
          events: { type: 'PING' };
        },
        actions: { log }
      }).createMachine({
        context: { count: 0 },
        on: {
          PING: { actions: 'log' }
        }
      });

      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      fixture.componentInstance.actor.send({ type: 'PING' });

      const audit = TestBed.inject(Audit);
      expect(audit.events).toEqual(['count=0']);
    });
  });

  describe('runInActorInjectionContext', () => {
    it('throws a friendly error for unregistered systems', () => {
      const lonely = createActor(toggleMachine);
      lonely.start();

      expect(() =>
        runInActorInjectionContext(lonely.system, () => 1)
      ).toThrowError(/no Angular Injector registered/);

      lonely.stop();
    });

    it('runs the callback when the actor was created via useActorRef', () => {
      @Component({ standalone: true, template: '' })
      class HostComponent {
        actor = useActorRef(toggleMachine);
        readonly resolvedInjector = runInActorInjectionContext(
          this.actor.system,
          () => inject(Injector)
        );
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.resolvedInjector).toBeInstanceOf(Object);
    });
  });

  describe('isolation between components', () => {
    it('two host components keep their own actors and injectors', () => {
      @Component({ selector: 'host-a', standalone: true, template: '' })
      class HostA {
        actor = useActorRef(toggleMachine);
      }
      @Component({ selector: 'host-b', standalone: true, template: '' })
      class HostB {
        actor = useActorRef(toggleMachine);
      }

      const fA = TestBed.createComponent(HostA);
      const fB = TestBed.createComponent(HostB);
      fA.detectChanges();
      fB.detectChanges();

      const aActor = fA.componentInstance.actor;
      const bActor = fB.componentInstance.actor;
      expect(aActor).not.toBe(bActor);
      expect(aActor.system).not.toBe(bActor.system);

      aActor.send({ type: 'TOGGLE' });
      expect(aActor.getSnapshot().value).toBe('active');
      expect(bActor.getSnapshot().value).toBe('inactive');
    });
  });

  describe('re-exports', () => {
    it('re-exports createMachine from xstate', () => {
      expect(reExportedCreateMachine).toBe(createMachine);
    });
  });
});
