import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { create_chat_reaction_picker } from '../../chat-reaction-picker';
test('ranks retained counts across distinct tables and freezes the snapshot for exactly 24 hours', () => {
 const db = new Database(':memory:');
 db.run('CREATE TABLE a(reaction TEXT); CREATE TABLE b(reaction TEXT)');
 db.run("INSERT INTO a VALUES ('🦄'), ('🦄'), ('👍'); INSERT INTO b VALUES ('👍'), ('👍'), ('❤️')");
 const choices = create_chat_reaction_picker(db, ['a', 'b', 'b']);
 const first = choices(0);
 expect(first.slice(0, 2)).toEqual(['👍', '🦄']);
 expect(first.length).toBe(18); expect(new Set(first).size).toBe(18);
 first[0] = 'corrupted';
 db.run("DELETE FROM a; DELETE FROM b; INSERT INTO b VALUES ('🐠')");
 expect(choices(86399999)[0]).toBe('👍');
 expect(choices(86400000)[0]).toBe('🐠');
 expect(create_chat_reaction_picker(db, ['a','b'])(0)[0]).toBe('🐠');
 db.close();
});
