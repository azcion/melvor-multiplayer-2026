// Disposable crash/restart fixture; never targets the application database.
import { Database } from 'bun:sqlite';
import { start_combat_authority } from '../../combat-authority';
import { start_combat_service } from '../../combat/service';
const [mode, address, key, port] = Bun.argv.slice(2);
if (mode === 'authority') {
	const db = new Database(address!); db.run('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
	const authority = start_combat_authority({database:db,key:key!,hostname:'127.0.0.1',port:Number(port??0),admitted:()=>true});
	console.log(authority.server.port);
	process.once('SIGTERM',()=>void authority.stop().then(()=>{db.close();process.exit(0);}));
} else {
	const service = start_combat_service({key:key!,authority_url:address,hostname:'127.0.0.1',port:0});
	console.log(service.server.port);
	process.once('SIGTERM',()=>void service.stop().then(()=>process.exit(0)));
}
