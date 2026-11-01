/* 純資料邏輯：不操作 DOM，不使用網路；可由 Node 執行測試。 */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ExamCore=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VERSION=1;
  function empty(){return {schemaVersion:VERSION,attempts:[],flags:{},essays:{},activeQuiz:null};}
  function pool(bank,scope,state){
    let list=bank.filter(q=>q.type==='mc');
    if(/^\d{3}$/.test(String(scope)))list=list.filter(q=>q.year===Number(scope));
    if(scope==='must')list=list.filter(q=>q.must);
    if(scope==='wrong'){
      const ids=new Set(wrongs(state,bank).filter(w=>!state.flags[w.id]?.familiar).map(w=>w.id));
      list=list.filter(q=>ids.has(q.id));
    }
    return list;
  }
  function sample(list,count,random=Math.random){
    const arr=list.slice();for(let i=arr.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
    return arr.slice(0,count==='all'?arr.length:Math.max(0,Math.min(Number(count)||0,arr.length)));
  }
  function grade(bank,quiz,now=new Date().toISOString()){
    const byId=new Map(bank.filter(q=>q.type==='mc').map(q=>[q.id,q]));
    if(!quiz.ids.length||new Set(quiz.ids).size!==quiz.ids.length)throw Error('測驗題目清單無效。');
    const answers=quiz.ids.map(id=>{
      const q=byId.get(id);if(!q)throw Error('測驗包含非選擇題或不存在的題目。');
      const selected=quiz.answers[id]??null;
      if(selected!==null&&!['A','B','C','D'].includes(selected))throw Error('答案格式無效。');
      return {id,year:q.year,number:q.number,stem:q.stem,selected,correct:q.answer,result:selected===null?'unanswered':selected===q.answer?'correct':'wrong'};
    });
    return {id:quiz.id,date:now,answers};
  }
  function score(attempt){
    const total=attempt.answers.length,correct=attempt.answers.filter(a=>a.result==='correct').length;
    const wrong=attempt.answers.filter(a=>a.result==='wrong').length;
    return {total,correct,wrong,unanswered:total-correct-wrong,rate:total?Math.round(correct/total*100):0};
  }
  function wrongs(state,bank){
    const valid=new Set(bank.filter(q=>q.type==='mc').map(q=>q.id)),map=new Map();
    for(const t of state.attempts)for(const a of t.answers){
      if(a.result!=='wrong'||!valid.has(a.id))continue;
      const old=map.get(a.id)||{id:a.id,count:0,lastDate:'',selected:null,correct:a.correct,stem:a.stem};old.count++;
      if(t.date>=old.lastDate){old.lastDate=t.date;old.selected=a.selected;old.correct=a.correct;old.stem=a.stem;}
      map.set(a.id,old);
    }
    return [...map.values()].sort((a,b)=>b.lastDate.localeCompare(a.lastDate)||b.count-a.count);
  }
  function stats(state,bank,year=null){
    const answers=state.attempts.flatMap(t=>t.answers).filter(a=>!year||a.year===year);
    const answered=answers.filter(a=>a.selected!==null),correct=answered.filter(a=>a.result==='correct').length;
    const mc=bank.filter(q=>q.type==='mc'&&(!year||q.year===year));
    const ids=new Set(mc.map(q=>q.id));
    return {total:mc.length,practiced:new Set(answered.map(a=>a.id).filter(id=>ids.has(id))).size,answered:answered.length,correct,rate:answered.length?Math.round(correct/answered.length*100):null,
      wrong:wrongs(state,bank).filter(w=>ids.has(w.id)&&!state.flags[w.id]?.familiar).length,
      familiar:mc.filter(q=>state.flags[q.id]?.familiar).length,read:mc.filter(q=>state.flags[q.id]?.read).length,
      latest:state.attempts.length?score(state.attempts[state.attempts.length-1]):null};
  }
  function validDate(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
  function validateState(data,bank){
    if(!data||data.schemaVersion!==VERSION||!Array.isArray(data.attempts)||!data.flags||!data.essays)throw Error('不是支援的學習紀錄備份格式。');
    const byId=new Map(bank.map(q=>[q.id,q]));const result=empty();
    const attemptIds=new Set();
    for(const t of data.attempts){
      if(!t||typeof t.id!=='string'||t.id.length>150||!validDate(t.date)||!Array.isArray(t.answers)||!t.answers.length||attemptIds.has(t.id))throw Error('測驗紀錄格式無效或場次重複。');
      attemptIds.add(t.id);const seen=new Set();
      const answers=t.answers.map(a=>{
        const q=byId.get(a.id);
        if(!q||q.type!=='mc'||seen.has(a.id)||!(a.selected===null||['A','B','C','D'].includes(a.selected))||!['A','B','C','D'].includes(a.correct)||a.year!==q.year||a.number!==q.number||typeof a.stem!=='string')throw Error('備份包含不支援或重複的題目紀錄。');
        seen.add(a.id);const expected=a.selected===null?'unanswered':a.selected===a.correct?'correct':'wrong';
        if(a.result!==expected)throw Error('備份批改結果與答案不一致。');
        return {id:a.id,year:a.year,number:a.number,stem:a.stem,selected:a.selected,correct:a.correct,result:a.result};
      });result.attempts.push({id:t.id,date:t.date,answers});
    }
    for(const [id,f] of Object.entries(data.flags)){
      if(!byId.has(id)||!f||!validDate(f.updatedAt)||['favorite','familiar','read'].some(k=>typeof f[k]!=='boolean'))throw Error('題目標記格式無效。');
      result.flags[id]={favorite:f.favorite,familiar:f.familiar,read:f.read,updatedAt:f.updatedAt};
    }
    for(const [id,e] of Object.entries(data.essays)){
      if(byId.get(id)?.type!=='essay'||!e||typeof e.text!=='string'||e.text.length>100000||!['','待加強','部分掌握','已掌握'].includes(e.assessment)||!validDate(e.updatedAt))throw Error('非選擇題筆記格式無效。');
      result.essays[id]={text:e.text,assessment:e.assessment,updatedAt:e.updatedAt};
    }
    if(data.activeQuiz){
      const q=data.activeQuiz;
      if(typeof q.id!=='string'||q.id.length>150||!Array.isArray(q.ids)||!q.ids.length||new Set(q.ids).size!==q.ids.length||q.ids.some(id=>byId.get(id)?.type!=='mc')||!Number.isInteger(q.index)||q.index<0||q.index>=q.ids.length||!q.answers||typeof q.answers!=='object'||!validDate(q.startedAt))throw Error('未完成測驗格式無效。');
      const answers={};for(const [id,a] of Object.entries(q.answers)){if(!q.ids.includes(id)||!['A','B','C','D'].includes(a))throw Error('未完成測驗的答案無效。');answers[id]=a;}
      result.activeQuiz={id:q.id,ids:q.ids.slice(),index:q.index,answers,startedAt:q.startedAt};
    }
    result.attempts.sort((a,b)=>a.date.localeCompare(b.date));return result;
  }
  function merge(current,incoming,bank){
    const a=validateState(current,bank),b=validateState(incoming,bank);
    const map=new Map(a.attempts.map(t=>[t.id,t]));
    for(const t of b.attempts){
      if(map.has(t.id)&&JSON.stringify(map.get(t.id))!==JSON.stringify(t))throw Error('同一測驗場次的內容衝突，未匯入。');
      map.set(t.id,t);
    }
    const merged=empty();merged.attempts=[...map.values()].sort((x,y)=>x.date.localeCompare(y.date));
    for(const field of ['flags','essays']){
      merged[field]={...a[field]};for(const [id,val] of Object.entries(b[field]))if(!merged[field][id]||val.updatedAt>merged[field][id].updatedAt)merged[field][id]=val;
    }
    merged.activeQuiz=a.activeQuiz||b.activeQuiz;
    if(merged.activeQuiz&&map.has(merged.activeQuiz.id))merged.activeQuiz=null;
    return merged;
  }
  return {VERSION,empty,pool,sample,grade,score,wrongs,stats,validateState,merge};
});
