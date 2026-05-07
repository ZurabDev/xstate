/**
 * Tests that pin down the _injector capture semantics_ of the package:
 *
 * - `useActorRef`/`useMachine` capture the Angular `Injector` of the surrounding
 *   injection context. Whatever `inject(...)` would return at the point of the
 *   call — that is what `fromPromiseInjectable`, `fromCallbackInjectable`,
 *   `fromObservableInjectable`, and `actionInjectable` will see when they run
 *   their callback.
 * - Component-level `providers: []` are honored.
 * - Two components with the same token but different local values produce two
 *   actors that resolve the token to two different values, simultaneously.
 * - Hierarchical injection: a value provided on an ancestor is visible to a
 *   descendant component that creates the actor.
 * - When the actor is created via a `useFactory` provider on a parent, the
 *   captured injector is the _parent's_ — children that reach into the actor
 *   see the parent's tokens, not their own. This is a deliberate, documented
 *   trade-off and is asserted here so it does not regress.
 */
import { describe, expect, it } from 'vitest';
import { Component, Injectable, InjectionToken, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { type Actor, assign, setup } from 'xstate';
import {
  actionInjectable,
  fromCallbackInjectable,
  fromObservableInjectable,
  fromPromiseInjectable,
  useActorRef,
  useMachine,
  useSelector
} from './index';
import { of } from 'rxjs';

const TOKEN = new InjectionToken<string>('TOKEN');

describe('@xstate/angular — injector capture', () => {
  describe('component-scoped providers', () => {
    it('fromPromiseInjectable sees the component-local provider value', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-host',
        providers: [{ provide: TOKEN, useValue: 'from-component' }],
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();

      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.value).toBe(
        'from-component'
      );
    });

    it('two simultaneous components with different TOKEN resolve to different values', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-host-a',
        providers: [{ provide: TOKEN, useValue: 'A' }],
        template: ''
      })
      class HostA {
        m = useMachine(machine);
      }

      @Component({
        standalone: true,
        selector: 'cap-host-b',
        providers: [{ provide: TOKEN, useValue: 'B' }],
        template: ''
      })
      class HostB {
        m = useMachine(machine);
      }

      const fa = TestBed.createComponent(HostA);
      const fb = TestBed.createComponent(HostB);
      fa.detectChanges();
      fb.detectChanges();

      await Promise.resolve();
      await Promise.resolve();

      expect(fa.componentInstance.m.snapshot().context.value).toBe('A');
      expect(fb.componentInstance.m.snapshot().context.value).toBe('B');
    });
  });

  describe('actionInjectable sees component-local DI', () => {
    it('an action body resolves a token provided on the component', () => {
      const seen: string[] = [];
      const log = actionInjectable(() => {
        seen.push(inject(TOKEN));
      });

      const machine = setup({
        actions: { log }
      }).createMachine({
        on: { PING: { actions: 'log' } }
      });

      @Component({
        standalone: true,
        selector: 'cap-action-host',
        providers: [{ provide: TOKEN, useValue: 'action-scope' }],
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      fixture.componentInstance.actor.send({ type: 'PING' });
      fixture.componentInstance.actor.send({ type: 'PING' });

      expect(seen).toEqual(['action-scope', 'action-scope']);
    });
  });

  describe('fromCallbackInjectable sees component-local DI', () => {
    it('callback body resolves a token provided on the component', () => {
      let captured = '';
      const greeter = fromCallbackInjectable(() => {
        captured = inject(TOKEN);
        return () => undefined;
      });

      const machine = setup({ actors: { greeter } }).createMachine({
        invoke: { src: 'greeter' }
      });

      @Component({
        standalone: true,
        selector: 'cap-cb-host',
        providers: [{ provide: TOKEN, useValue: 'cb-scope' }],
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(captured).toBe('cb-scope');
    });
  });

  describe('fromObservableInjectable sees component-local DI', () => {
    it('observable creator resolves a token provided on the component', () => {
      let captured = '';
      const stream = fromObservableInjectable(() => {
        captured = inject(TOKEN);
        return of(0);
      });

      const machine = setup({ actors: { stream } }).createMachine({
        invoke: { src: 'stream' }
      });

      @Component({
        standalone: true,
        selector: 'cap-obs-host',
        providers: [{ provide: TOKEN, useValue: 'obs-scope' }],
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(captured).toBe('obs-scope');
    });
  });

  describe('hierarchical providers', () => {
    it('a token provided on an ancestor is visible to a child that calls useMachine', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      // The child has no provider for TOKEN — Angular DI must walk up to the
      // parent injector to resolve it.
      @Component({
        standalone: true,
        selector: 'cap-child',
        template: `<p id="cv">{{ m.snapshot().context.value ?? '...' }}</p>`
      })
      class ChildComponent {
        m = useMachine(machine);
      }

      @Component({
        standalone: true,
        selector: 'cap-parent',
        imports: [ChildComponent],
        providers: [{ provide: TOKEN, useValue: 'inherited-from-parent' }],
        template: `<cap-child />`
      })
      class ParentComponent {}

      const fixture = TestBed.createComponent(ParentComponent);
      fixture.detectChanges();

      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const text = fixture.debugElement.query(By.css('#cv')).nativeElement
        .textContent;
      expect(text).toBe('inherited-from-parent');
    });
  });

  describe('component-private class instance (providers: [Class])', () => {
    @Injectable()
    class CounterStore {
      count = 0;
      increment() {
        this.count++;
      }
    }

    it('actor receives the SAME instance the component reads', () => {
      let captured: CounterStore | null = null;

      const check = actionInjectable(() => {
        captured = inject(CounterStore);
      });

      const machine = setup({
        actions: { check }
      }).createMachine({
        on: { CHECK: { actions: 'check' } }
      });

      @Component({
        standalone: true,
        selector: 'cap-same-instance',
        providers: [CounterStore],
        template: ''
      })
      class HostComponent {
        store = inject(CounterStore);
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const host = fixture.componentInstance;

      host.actor.send({ type: 'CHECK' });

      // strict identity — proves the actor and the component look at the
      // same object reference, not a copy nor a different injector tree
      expect(captured).toBe(host.store);
    });

    it('two components keep their own instances; actors see their own', async () => {
      const reader = fromPromiseInjectable<number>(
        async () => inject(CounterStore).count
      );

      const machine = setup({
        types: {} as { context: { value: number | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: number }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        initial: 'idle',
        states: {
          idle: { on: { REQUEST: 'loading' } },
          loading: {
            invoke: {
              src: 'reader',
              onDone: {
                target: 'idle',
                actions: {
                  type: 'set',
                  params: ({ event }) => ({ value: event.output })
                }
              }
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-instance-a',
        providers: [CounterStore],
        template: ''
      })
      class HostA {
        store = inject(CounterStore);
        m = useMachine(machine);
      }
      @Component({
        standalone: true,
        selector: 'cap-instance-b',
        providers: [CounterStore],
        template: ''
      })
      class HostB {
        store = inject(CounterStore);
        m = useMachine(machine);
      }

      const fa = TestBed.createComponent(HostA);
      const fb = TestBed.createComponent(HostB);
      fa.detectChanges();
      fb.detectChanges();

      const a = fa.componentInstance;
      const b = fb.componentInstance;

      expect(a.store).not.toBe(b.store);

      a.store.count = 11;
      b.store.count = 22;

      a.m.send({ type: 'REQUEST' });
      b.m.send({ type: 'REQUEST' });

      await Promise.resolve();
      await Promise.resolve();

      expect(a.m.snapshot().context.value).toBe(11);
      expect(b.m.snapshot().context.value).toBe(22);
    });

    it('mutation through the actor is observed by the component (one shared instance)', () => {
      const inc = actionInjectable(() => {
        inject(CounterStore).increment();
      });

      const machine = setup({ actions: { inc } }).createMachine({
        on: { TICK: { actions: 'inc' } }
      });

      @Component({
        standalone: true,
        selector: 'cap-mutation',
        providers: [CounterStore],
        template: ''
      })
      class HostComponent {
        store = inject(CounterStore);
        actor = useActorRef(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const host = fixture.componentInstance;

      expect(host.store.count).toBe(0);
      host.actor.send({ type: 'TICK' });
      host.actor.send({ type: 'TICK' });
      host.actor.send({ type: 'TICK' });

      // The component-owned instance reflects mutations made by the action
      expect(host.store.count).toBe(3);
    });

    it('two actors in one component share the same component-scoped instance', () => {
      const inc = actionInjectable(() => {
        inject(CounterStore).increment();
      });

      const m1 = setup({ actions: { inc } }).createMachine({
        on: { TICK: { actions: 'inc' } }
      });
      const m2 = setup({ actions: { inc } }).createMachine({
        on: { TICK: { actions: 'inc' } }
      });

      @Component({
        standalone: true,
        selector: 'cap-two-actors',
        providers: [CounterStore],
        template: ''
      })
      class HostComponent {
        store = inject(CounterStore);
        a = useActorRef(m1);
        b = useActorRef(m2);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const host = fixture.componentInstance;

      host.a.send({ type: 'TICK' });
      host.a.send({ type: 'TICK' });
      host.b.send({ type: 'TICK' });

      // Both actors mutated the same component-owned store
      expect(host.store.count).toBe(3);
    });
  });

  describe('multi-token resolution', () => {
    it('one creator can inject several component-local tokens at once', async () => {
      const A = new InjectionToken<string>('A');
      const B = new InjectionToken<string>('B');
      const C = new InjectionToken<number>('C');

      const reader = fromPromiseInjectable<{ a: string; b: string; c: number }>(
        async () => ({
          a: inject(A),
          b: inject(B),
          c: inject(C)
        })
      );

      const machine = setup({
        types: {} as {
          context: { result: { a: string; b: string; c: number } | null };
        },
        actors: { reader },
        actions: {
          set: assign({
            result: (_, p: { result: { a: string; b: string; c: number } }) =>
              p.result
          })
        }
      }).createMachine({
        context: { result: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ result: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-multi',
        providers: [
          { provide: A, useValue: 'alpha' },
          { provide: B, useValue: 'beta' },
          { provide: C, useValue: 99 }
        ],
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.result).toEqual({
        a: 'alpha',
        b: 'beta',
        c: 99
      });
    });
  });

  describe('root vs component shadowing', () => {
    it('a component-level provider shadows a root-level provider', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      TestBed.configureTestingModule({
        providers: [{ provide: TOKEN, useValue: 'root-value' }]
      });

      @Component({
        standalone: true,
        selector: 'cap-shadow',
        providers: [{ provide: TOKEN, useValue: 'component-value' }],
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.value).toBe(
        'component-value'
      );
    });

    it('without a component override, the root provider is used', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      TestBed.configureTestingModule({
        providers: [{ provide: TOKEN, useValue: 'root-only' }]
      });

      @Component({
        standalone: true,
        selector: 'cap-no-shadow',
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.value).toBe(
        'root-only'
      );
    });
  });

  describe('deep hierarchy: grandparent → parent → child', () => {
    it('TOKEN provided two levels up is visible inside the actor', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-leaf',
        template: `<p id="leaf">{{ m.snapshot().context.value ?? '...' }}</p>`
      })
      class LeafComponent {
        m = useMachine(machine);
      }

      @Component({
        standalone: true,
        selector: 'cap-mid',
        imports: [LeafComponent],
        template: `<cap-leaf />`
      })
      class MidComponent {}

      @Component({
        standalone: true,
        selector: 'cap-grand',
        imports: [MidComponent],
        providers: [{ provide: TOKEN, useValue: 'from-grandparent' }],
        template: `<cap-mid />`
      })
      class GrandComponent {}

      const fixture = TestBed.createComponent(GrandComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const text = fixture.debugElement.query(By.css('#leaf')).nativeElement
        .textContent;
      expect(text).toBe('from-grandparent');
    });

    it('the closest provider wins when the same TOKEN is provided at multiple levels', async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-close-leaf',
        providers: [{ provide: TOKEN, useValue: 'leaf' }],
        template: `<p id="leaf2">{{ m.snapshot().context.value ?? '...' }}</p>`
      })
      class LeafComponent {
        m = useMachine(machine);
      }

      @Component({
        standalone: true,
        selector: 'cap-close-mid',
        imports: [LeafComponent],
        providers: [{ provide: TOKEN, useValue: 'mid' }],
        template: `<cap-close-leaf />`
      })
      class MidComponent {}

      @Component({
        standalone: true,
        selector: 'cap-close-grand',
        imports: [MidComponent],
        providers: [{ provide: TOKEN, useValue: 'grand' }],
        template: `<cap-close-mid />`
      })
      class GrandComponent {}

      const fixture = TestBed.createComponent(GrandComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const text = fixture.debugElement.query(By.css('#leaf2')).nativeElement
        .textContent;
      // The leaf has its own TOKEN; the actor created in the leaf must see it,
      // not 'mid' nor 'grand'.
      expect(text).toBe('leaf');
    });
  });

  describe('optional injection', () => {
    it('returns null when the token is not provided anywhere', async () => {
      const MISSING = new InjectionToken<string>('MISSING');

      const reader = fromPromiseInjectable<string | null>(async () =>
        inject(MISSING, { optional: true })
      );

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({
            value: (_, p: { value: string | null }) => p.value
          })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-optional',
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.value).toBeNull();
    });
  });

  describe('chained services', () => {
    it('a component-scoped service that injects another service is fully reachable from the actor', async () => {
      @Injectable()
      class Inner {
        readonly answer = 42;
      }

      @Injectable()
      class Outer {
        private inner = inject(Inner);
        get value() {
          return this.inner.answer * 2;
        }
      }

      const reader = fromPromiseInjectable<number>(
        async () => inject(Outer).value
      );

      const machine = setup({
        types: {} as { context: { value: number | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: number }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      @Component({
        standalone: true,
        selector: 'cap-chain',
        providers: [Inner, Outer],
        template: ''
      })
      class HostComponent {
        m = useMachine(machine);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(fixture.componentInstance.m.snapshot().context.value).toBe(84);
    });
  });

  describe('useFactory captures the parent injector, not children', () => {
    it("when a parent provides the actor via useFactory, child injectors do NOT influence the actor's DI", async () => {
      const reader = fromPromiseInjectable<string>(async () => inject(TOKEN));

      const machine = setup({
        types: {} as { context: { value: string | null } },
        actors: { reader },
        actions: {
          set: assign({ value: (_, p: { value: string }) => p.value })
        }
      }).createMachine({
        context: { value: null },
        invoke: {
          src: 'reader',
          onDone: {
            actions: {
              type: 'set',
              params: ({ event }) => ({ value: event.output })
            }
          }
        }
      });

      const ACTOR = new InjectionToken<Actor<typeof machine>>('ACTOR');

      // Child has its own TOKEN, but the actor was already created in the
      // parent's injector — therefore the child's TOKEN must NOT win.
      @Component({
        standalone: true,
        selector: 'cap-shared-child',
        providers: [{ provide: TOKEN, useValue: 'child-wins-or-not' }],
        template: `<p id="v">{{ value() ?? '...' }}</p>`
      })
      class ChildComponent {
        value = useSelector(inject(ACTOR), (s) => s.context.value);
      }

      @Component({
        standalone: true,
        selector: 'cap-shared-parent',
        imports: [ChildComponent],
        providers: [
          { provide: TOKEN, useValue: 'parent-value' },
          { provide: ACTOR, useFactory: () => useActorRef(machine) }
        ],
        template: `<cap-shared-child />`
      })
      class ParentComponent {}

      const fixture = TestBed.createComponent(ParentComponent);
      fixture.detectChanges();

      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const text = fixture.debugElement.query(By.css('#v')).nativeElement
        .textContent;
      expect(text).toBe('parent-value');
    });
  });
});
