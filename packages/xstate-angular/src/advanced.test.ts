/**
 * Advanced integration tests covering the patterns most consumer apps end up
 * needing once the basics are wired:
 *
 * 1. Persistence / rehydration of actor state across actor instances
 * 2. Spawned child actors observed via `fromActorRef`
 * 3. A parent component that creates the actor, child components that consume it
 *    via Angular DI and `useSelector`
 * 4. Multiple selectors on the same actor — they only re-fire on slice change
 */
import { describe, expect, it } from 'vitest';
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  effect,
  inject
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { type Actor, type AnyActorRef, assign, setup } from 'xstate';
import { fromActorRef, useActorRef, useMachine, useSelector } from './index';

describe('@zurab/xstate-angular — advanced patterns', () => {
  describe('persistence and rehydration', () => {
    it('a second actor restored from getPersistedSnapshot resumes state', () => {
      const counterMachine = setup({
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
        selector: 'persist-host-1',
        template: ''
      })
      class FirstHost {
        m = useMachine(counterMachine);
      }

      const fixture1 = TestBed.createComponent(FirstHost);
      fixture1.detectChanges();
      const ref1 = fixture1.componentInstance.m.actorRef;
      ref1.send({ type: 'inc' });
      ref1.send({ type: 'inc' });
      ref1.send({ type: 'inc' });
      expect(ref1.getSnapshot().context.count).toBe(3);

      const persisted = ref1.getPersistedSnapshot();
      fixture1.destroy();

      @Component({
        standalone: true,
        selector: 'persist-host-2',
        template: ''
      })
      class SecondHost {
        m = useMachine(counterMachine, { snapshot: persisted });
      }

      const fixture2 = TestBed.createComponent(SecondHost);
      fixture2.detectChanges();
      const ref2 = fixture2.componentInstance.m.actorRef;

      expect(ref2.getSnapshot().context.count).toBe(3);
      ref2.send({ type: 'inc' });
      expect(ref2.getSnapshot().context.count).toBe(4);
    });
  });

  describe('spawned children observed via fromActorRef', () => {
    it('renders updates from a spawned child actor', () => {
      const childMachine = setup({
        types: {} as {
          context: { value: string };
          events: { type: 'SET'; value: string };
        }
      }).createMachine({
        context: { value: 'initial' },
        on: {
          SET: {
            actions: assign({
              value: ({ event }) => event.value
            })
          }
        }
      });

      const parentMachine = setup({
        types: {} as {
          context: { child: AnyActorRef };
        },
        actors: { child: childMachine }
      }).createMachine({
        context: ({ spawn }) => ({
          child: spawn('child', { id: 'kid' })
        })
      });

      @Component({
        standalone: true,
        selector: 'spawn-host',
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `<p id="v">{{ childSnap().context.value }}</p>`
      })
      class HostComponent {
        parent = useActorRef(parentMachine);
        childRef = this.parent.getSnapshot().context.child;
        childSnap = fromActorRef(this.childRef);
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      const cell = () =>
        fixture.debugElement.query(By.css('#v')).nativeElement.textContent;
      expect(cell()).toBe('initial');

      fixture.componentInstance.childRef.send({
        type: 'SET',
        value: 'updated'
      });
      fixture.detectChanges();
      expect(cell()).toBe('updated');
    });
  });

  describe('parent provides actor to children via InjectionToken', () => {
    it('child component reads slices via useSelector and reflects parent updates', () => {
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

      const COUNTER = new InjectionToken<Actor<typeof machine>>('COUNTER');

      @Component({
        standalone: true,
        selector: 'shared-child',
        template: `<span id="cc">{{ count() }}</span>`
      })
      class ChildComponent {
        count = useSelector(inject(COUNTER), (s) => s.context.count);
      }

      @Component({
        standalone: true,
        selector: 'shared-parent',
        imports: [ChildComponent],
        providers: [
          {
            provide: COUNTER,
            useFactory: () => useActorRef(machine)
          }
        ],
        template: `
          <button id="b" (click)="actor.send({ type: 'inc' })">+</button>
          <shared-child />
          <shared-child />
        `
      })
      class ParentComponent {
        actor = inject(COUNTER);
      }

      const fixture = TestBed.createComponent(ParentComponent);
      fixture.detectChanges();

      const cells = () =>
        fixture.debugElement
          .queryAll(By.css('#cc'))
          .map((el) => el.nativeElement.textContent);
      expect(cells()).toEqual(['0', '0']);

      fixture.debugElement
        .query(By.css('#b'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(cells()).toEqual(['1', '1']);

      fixture.debugElement
        .query(By.css('#b'))
        .triggerEventHandler('click', null);
      fixture.detectChanges();
      expect(cells()).toEqual(['2', '2']);
    });
  });

  describe('multiple selectors on the same actor', () => {
    it('each selector re-fires only on its own slice change', () => {
      const machine = setup({
        types: {} as { context: { a: number; b: number } }
      }).createMachine({
        context: { a: 0, b: 0 },
        on: {
          incA: { actions: assign({ a: ({ context }) => context.a + 1 }) },
          incB: { actions: assign({ b: ({ context }) => context.b + 1 }) }
        }
      });

      let aRuns = 0;
      let bRuns = 0;

      @Component({
        standalone: true,
        selector: 'multi-sel-host',
        template: ''
      })
      class HostComponent {
        actor = useActorRef(machine);
        a = useSelector(this.actor, (s) => s.context.a);
        b = useSelector(this.actor, (s) => s.context.b);

        constructor() {
          effect(() => {
            void this.a();
            aRuns++;
          });
          effect(() => {
            void this.b();
            bRuns++;
          });
        }
      }

      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      expect(aRuns).toBe(1);
      expect(bRuns).toBe(1);

      fixture.componentInstance.actor.send({ type: 'incA' });
      fixture.detectChanges();
      expect(aRuns).toBe(2);
      expect(bRuns).toBe(1);

      fixture.componentInstance.actor.send({ type: 'incB' });
      fixture.detectChanges();
      expect(aRuns).toBe(2);
      expect(bRuns).toBe(2);

      // No-op transition (no event listed for `noop`) — neither slice updates.
      fixture.componentInstance.actor.send({ type: 'noop' as 'incA' });
      fixture.detectChanges();
      expect(aRuns).toBe(2);
      expect(bRuns).toBe(2);
    });
  });
});
