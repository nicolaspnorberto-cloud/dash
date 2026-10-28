import {prepareTrainingFiles} from './training-files.mjs';
export const prepareAnomalyFiles=prepareTrainingFiles;
export function anomalyFileStatements(db,files){
 const statements=[];for(const f of files){statements.push(db.prepare('INSERT OR IGNORE INTO misscan_anomaly_files(id,anomaly_id,name,mime_type,size,created_at) VALUES(?,?,?,?,?,?)').bind(f.id,f.eventId,f.name,f.type,f.size,f.createdAt));for(let offset=0,i=0;offset<f.bytes.length;offset+=500000,i++)statements.push(db.prepare('INSERT OR IGNORE INTO misscan_anomaly_file_chunks(file_id,chunk_index,data) VALUES(?,?,?)').bind(f.id,i,f.bytes.slice(offset,offset+500000).buffer));}return statements;
}
