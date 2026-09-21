import assert from 'node:assert/strict';
import { attachmentInputText, imageAttachmentInput } from '../app/codex-attachment-input.ts';
const file = {name:'原图.zip',type:'application/zip',size:2090008,url:'https://vesper.r-vera.com/api/media/test.zip'};
assert.match(attachmentInputText(file), /Download URL: https:\/\/vesper.r-vera.com\/api\/media\/test.zip/);
for (const url of ['blob:https://vesper.r-vera.com/temp','data:text/plain,test','file:///tmp/file.zip']) {
 assert.throws(()=>attachmentInputText({...file,url}),/download URL/);
}
console.log('attachment download URL and local-only URL rejection: ok');

const photos = ['one','two'].map(id => ({key:`photos/${id}.jpg`,name:`${id}.jpg`,type:'image/jpeg',size:123,url:`https://vesper.r-vera.com/api/media/${id}.jpg`}));
const prepared = photos.map(photo => imageAttachmentInput(photo,'data:image/jpeg;base64,preview'));
const modelText = prepared.map(item => item.text).filter(Boolean).join('\n\n');
for (const [i,item] of prepared.entries()) {
 assert.equal(item.attachment,photos[i]);
 assert.deepEqual(item.input,{type:'image',url:'data:image/jpeg;base64,preview'});
 assert.ok(modelText.includes(`Vesper photo key: ${JSON.stringify(photos[i].key)}`));
 assert.ok(modelText.includes(photos[i].url));
}
assert.match(modelText,/do not save every image automatically/);
console.log('Image previews retain exact archive keys and download context for multi-photo turns: ok');
