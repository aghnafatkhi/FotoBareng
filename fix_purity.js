const fs = require('fs');
const file = 'app/[roomCode]/page.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/setCameraStatus\('loading'\);/g, '');
code = code.replace(/setResultError\(false\);/g, '');
code = code.replace(/setParticipantId\(pId\);/g, 'setTimeout(() => setParticipantId(pId), 0);');
code = code.replace(/setError\('need_join'\);/g, 'setTimeout(() => setError("need_join"), 0);');

fs.writeFileSync(file, code);
