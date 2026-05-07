/**
 * End-to-end "fetcher" pattern: a machine has a fetch actor that goes through
 * an Angular service, the service emulates a backend (in-memory store with
 * controllable failure), and the test verifies that:
 *
 * 1. The component mounts in `loading`, then transitions to `loaded` with the data
 *    the service produced.
 * 2. Mutating the service and sending REFRESH re-pulls the data.
 * 3. A rejection from the service drives the machine to `failed`, exposes the
 *    error message, and RETRY recovers.
 * 4. Two components share the same root-provided service consistently.
 */
import { describe, expect, it } from 'vitest';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { assign, setup } from 'xstate';
import { fromPromiseInjectable, useMachine } from './index';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

@Injectable({ providedIn: 'root' })
class TodoApiService {
  private store: Todo[] = [
    { id: 1, title: 'Write docs', done: false },
    { id: 2, title: 'Ship beta', done: false }
  ];

  shouldFail = false;

  async fetchAll(): Promise<Todo[]> {
    if (this.shouldFail) {
      throw new Error('network down');
    }
    return [...this.store];
  }

  add(title: string): void {
    this.store.push({ id: this.store.length + 1, title, done: false });
  }

  toggle(id: number): void {
    const t = this.store.find((x) => x.id === id);
    if (t) t.done = !t.done;
  }
}

const fetchTodos = fromPromiseInjectable<Todo[]>(async () =>
  inject(TodoApiService).fetchAll()
);

const todosMachine = setup({
  types: {} as {
    context: { items: Todo[]; error: string | null };
    events: { type: 'REFRESH' } | { type: 'RETRY' };
  },
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
            params: ({ event }) => ({
              message: (event.error as Error).message
            })
          }
        }
      }
    },
    loaded: { on: { REFRESH: 'loading' } },
    failed: { on: { RETRY: 'loading' } }
  }
});

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('@zurab/xstate-angular — fetcher driven by an Angular service', () => {
  it('mounts in `loading`, then loads items from the service into the snapshot', async () => {
    @Component({
      standalone: true,
      selector: 'todos-host',
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        @let s = todos.snapshot();
        <p id="state">{{ s.value }}</p>
        @if (s.matches('loaded')) {
          <ul>
            @for (t of s.context.items; track t.id) {
              <li class="t">{{ t.title }}</li>
            }
          </ul>
        }
      `
    })
    class HostComponent {
      todos = useMachine(todosMachine);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('#state')).nativeElement.textContent
    ).toBe('loading');

    await flushMicrotasks();
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('#state')).nativeElement.textContent
    ).toBe('loaded');

    const titles = fixture.debugElement
      .queryAll(By.css('.t'))
      .map((el) => el.nativeElement.textContent);
    expect(titles).toEqual(['Write docs', 'Ship beta']);
  });

  it('REFRESH re-pulls data after the service has been mutated', async () => {
    @Component({
      standalone: true,
      selector: 'todos-refresh-host',
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        @for (t of todos.snapshot().context.items; track t.id) {
          <li class="t">{{ t.title }}</li>
        }
      `
    })
    class HostComponent {
      todos = useMachine(todosMachine);
    }

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.t')).length).toBe(2);

    // Mutate the backing store via the SAME Angular service the actor uses
    TestBed.inject(TodoApiService).add('Polish UX');

    fixture.componentInstance.todos.send({ type: 'REFRESH' });
    await flushMicrotasks();
    fixture.detectChanges();

    const titles = fixture.debugElement
      .queryAll(By.css('.t'))
      .map((el) => el.nativeElement.textContent);
    expect(titles).toEqual(['Write docs', 'Ship beta', 'Polish UX']);
  });

  it('rejection from the service moves the machine to `failed` and RETRY recovers', async () => {
    @Component({
      standalone: true,
      selector: 'todos-fail-host',
      template: ''
    })
    class HostComponent {
      todos = useMachine(todosMachine);
    }

    // Make the very first fetch fail
    TestBed.inject(TodoApiService).shouldFail = true;

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    await flushMicrotasks();

    let snap = fixture.componentInstance.todos.snapshot();
    expect(snap.value).toBe('failed');
    expect(snap.context.error).toBe('network down');
    expect(snap.context.items).toEqual([]);

    // Recover: turn off the failure, send RETRY
    TestBed.inject(TodoApiService).shouldFail = false;
    fixture.componentInstance.todos.send({ type: 'RETRY' });

    await flushMicrotasks();

    snap = fixture.componentInstance.todos.snapshot();
    expect(snap.value).toBe('loaded');
    expect(snap.context.error).toBeNull();
    expect(snap.context.items.map((t) => t.title)).toEqual([
      'Write docs',
      'Ship beta'
    ]);
  });

  it('two components share the same root-provided service', async () => {
    @Component({
      standalone: true,
      selector: 'todos-share-a',
      template: ''
    })
    class HostA {
      todos = useMachine(todosMachine);
    }
    @Component({
      standalone: true,
      selector: 'todos-share-b',
      template: ''
    })
    class HostB {
      todos = useMachine(todosMachine);
    }

    const fa = TestBed.createComponent(HostA);
    const fb = TestBed.createComponent(HostB);
    fa.detectChanges();
    fb.detectChanges();
    await flushMicrotasks();

    expect(fa.componentInstance.todos.snapshot().context.items).toHaveLength(2);
    expect(fb.componentInstance.todos.snapshot().context.items).toHaveLength(2);

    // Mutate the shared service through the test, refresh in A
    TestBed.inject(TodoApiService).add('Pair-write');
    fa.componentInstance.todos.send({ type: 'REFRESH' });
    await flushMicrotasks();

    expect(
      fa.componentInstance.todos.snapshot().context.items.map((t) => t.title)
    ).toContain('Pair-write');

    // B has not refreshed yet — it must still show stale data, proving each
    // actor pulls independently.
    expect(fb.componentInstance.todos.snapshot().context.items).toHaveLength(2);

    fb.componentInstance.todos.send({ type: 'REFRESH' });
    await flushMicrotasks();

    expect(fb.componentInstance.todos.snapshot().context.items).toHaveLength(3);
  });
});
