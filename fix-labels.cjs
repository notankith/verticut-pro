const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://ankits6173:3F79O0V2g4vKjJ9g@cluster0.p71ic.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('Cluster0');
  
  await db.collection('settings').updateOne(
    { _id: 'global' },
    { $set: { 'presets.$[].text': '‎ ', defaultLabelText: '‎ ' } }
  );
  
  // also update any clips that might have this text baked in
  const projects = await db.collection('projects').find({}).toArray();
  for (const p of projects) {
    if (p.clips) {
      let changed = false;
      for (const c of p.clips) {
        if (c.labelText && c.labelText.includes('Getty')) {
          c.labelText = '‎ ';
          changed = true;
        }
      }
      if (changed) {
        await db.collection('projects').updateOne({ _id: p._id }, { $set: { clips: p.clips } });
      }
    }
  }
  
  console.log('Fixed');
  process.exit(0);
}
run();
