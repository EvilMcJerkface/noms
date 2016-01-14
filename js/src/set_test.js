// @flow

import {assert} from 'chai';
import {suite} from 'mocha';

import MemoryStore from './memory_store.js';
import test from './async_test.js';
import type {ChunkStore} from './chunk_store.js';
import {invariant} from './assert.js';
import {Kind} from './noms_kind.js';
import {makeCompoundType, makePrimitiveType} from './type.js';
import {MetaTuple, OrderedMetaSequence} from './meta_sequence.js';
import {NomsSet, SetLeafSequence} from './set.js';
import {notNull} from './assert.js';
import {OrderedSequence} from './ordered_sequence.js';
import {writeValue} from './encode.js';

suite('SetLeaf', () => {
  test('first/has', async () => {
    const ms = new MemoryStore();
    const tr = makeCompoundType(Kind.Set, makePrimitiveType(Kind.String));
    const s = new NomsSet(ms, tr, new SetLeafSequence(tr, ['a', 'k']));

    assert.strictEqual('a', await s.first());

    assert.isTrue(await s.has('a'));
    assert.isFalse(await s.has('b'));
    assert.isTrue(await s.has('k'));
    assert.isFalse(await s.has('z'));
  });

  test('forEach', async () => {
    const ms = new MemoryStore();
    const tr = makeCompoundType(Kind.Set, makePrimitiveType(Kind.String));
    const m = new NomsSet(ms, tr, new SetLeafSequence(tr, ['a', 'b']));

    const values = [];
    await m.forEach((k) => { values.push(k); });
    assert.deepEqual(['a', 'b'], values);
  });

  test('chunks', () => {
    const ms = new MemoryStore();
    const tr = makeCompoundType(Kind.Set, makePrimitiveType(Kind.Value));
    const st = makePrimitiveType(Kind.String);
    const r1 = writeValue('x', st, ms);
    const r2 = writeValue('a', st, ms);
    const r3 = writeValue('b', st, ms);
    const l = new NomsSet(ms, tr, new SetLeafSequence(tr, ['z', r1, r2, r3]));
    assert.strictEqual(3, l.chunks.length);
    assert.isTrue(r1.equals(l.chunks[0]));
    assert.isTrue(r2.equals(l.chunks[1]));
    assert.isTrue(r3.equals(l.chunks[2]));
  });
});

suite('CompoundSet', () => {
  function build(cs: ChunkStore, values: Array<string>): NomsSet {
    const tr = makeCompoundType(Kind.Set, makePrimitiveType(Kind.String));
    assert.isTrue(values.length > 1 && Math.log2(values.length) % 1 === 0);

    let tuples = [];
    for (let i = 0; i < values.length; i += 2) {
      const l = new NomsSet(cs, tr, new SetLeafSequence(tr, [values[i], values[i + 1]]));
      const r = writeValue(l, tr, cs);
      tuples.push(new MetaTuple(r, values[i + 1]));
    }

    let last: ?NomsSet = null;
    while (tuples.length > 1) {
      const next = [];
      for (let i = 0; i < tuples.length; i += 2) {
        last = new NomsSet(cs, tr, new OrderedMetaSequence(tr, [tuples[i], tuples[i + 1]]));
        const r = writeValue(last, tr, cs);
        next.push(new MetaTuple(r, tuples[i + 1].value));
      }

      tuples = next;
    }

    return notNull(last);
  }

  test('first/has', async () => {
    const ms = new MemoryStore();
    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);
    assert.strictEqual('a', await c.first());
    assert.isTrue(await c.has('a'));
    assert.isTrue(await c.has('b'));
    assert.isFalse(await c.has('c'));
    assert.isFalse(await c.has('d'));
    assert.isTrue(await c.has('e'));
    assert.isTrue(await c.has('f'));
    assert.isTrue(await c.has('h'));
    assert.isTrue(await c.has('i'));
    assert.isFalse(await c.has('j'));
    assert.isFalse(await c.has('k'));
    assert.isFalse(await c.has('l'));
    assert.isTrue(await c.has('m'));
    assert.isTrue(await c.has('n'));
    assert.isFalse(await c.has('o'));
  });

  test('forEach', async () => {
    const ms = new MemoryStore();
    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);
    const values = [];
    await c.forEach((k) => { values.push(k); });
    assert.deepEqual(['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n'], values);
  });

  test('chunks', () => {
    const ms = new MemoryStore();
    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);
    assert.strictEqual(2, c.chunks.length);
  });

  test('map', async () => {
    const ms = new MemoryStore();
    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);
    const values = await c.map((k) => k + '*');
    assert.deepEqual(['a*', 'b*', 'e*', 'f*', 'h*', 'i*', 'm*', 'n*'], values);
  });

  test('map async', async () => {
    const ms = new MemoryStore();
    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);
    const values = await c.map((k) => Promise.resolve(k + '*'));
    assert.deepEqual(['a*', 'b*', 'e*', 'f*', 'h*', 'i*', 'm*', 'n*'], values);
  });

  async function asyncAssertThrows(f: () => any):Promise<boolean> {
    let error: any = null;
    try {
      await f();
    } catch (er) {
      error = er;
    }

    return error !== null;
  }

  test('advanceTo', async () => {
    const ms = new MemoryStore();

    const c = build(ms, ['a', 'b', 'e', 'f', 'h', 'i', 'm', 'n']);

    invariant(c.sequence instanceof OrderedSequence);
    let cursor = await c.sequence.newCursorAt(c.cs, null);
    assert.ok(cursor);
    assert.strictEqual('a', cursor.getCurrent());

    assert.isTrue(await cursor.advanceTo('h'));
    assert.strictEqual('h', cursor.getCurrent());

    assert.isTrue(await cursor.advanceTo('k'));
    assert.strictEqual('m', cursor.getCurrent());

    assert.isFalse(await cursor.advanceTo('z')); // not found
    assert.isFalse(cursor.valid);

    invariant(c.sequence instanceof OrderedSequence);
    cursor = await c.sequence.newCursorAt(ms, 'x'); // not found
    assert.isFalse(cursor.valid);

    invariant(c.sequence instanceof OrderedSequence);
    cursor = await c.sequence.newCursorAt(ms, 'e');
    assert.ok(cursor);
    assert.strictEqual('e', cursor.getCurrent());

    assert.isTrue(await cursor.advanceTo('m'));
    assert.strictEqual('m', cursor.getCurrent());

    assert.isTrue(await cursor.advanceTo('n'));
    assert.strictEqual('n', cursor.getCurrent());

    assert.isFalse(await cursor.advanceTo('s'));
    assert.isFalse(cursor.valid);

    asyncAssertThrows(async () => {
      await notNull(cursor).advanceTo('x');
    });
  });

  async function testIntersect(expect: Array<string>, seqs: Array<Array<string>>) {
    const ms = new MemoryStore();

    const first = build(ms, seqs[0]);
    const sets:Array<NomsSet> = [];
    for (let i = 1; i < seqs.length; i++) {
      sets.push(build(ms, seqs[i]));
    }

    const result = await first.intersect(...sets);
    const actual = [];
    await result.forEach(v => { actual.push(v); });
    assert.deepEqual(expect, actual);
  }

  test('intersect', async () => {
    await testIntersect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']]);
    await testIntersect(['a', 'h'], [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['a', 'h', 'i', 'j', 'k', 'l', 'm', 'n']]);
    await testIntersect(['d', 'e', 'f', 'g', 'h'], [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k']]);
    await testIntersect(['h'], [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], ['h', 'i', 'j', 'k', 'l', 'm', 'n', 'o']]);
    await testIntersect([], [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], ['i', 'j', 'k', 'l', 'm', 'n', 'o', 'p']]);
  });
});