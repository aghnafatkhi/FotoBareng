const fs = require('fs');
const file = 'app/[roomCode]/page.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const \[uploadError, setUploadError\] = useState\(false\);/, 
`const [uploadError, setUploadError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(int);
  }, []);`);
  
code = code.replace(/Date\.now\(\) - \(p\.updatedAt \|\| 0\) > 15000/g, 'now - (p.updatedAt || 0) > 15000');
  
fs.writeFileSync(file, code);
