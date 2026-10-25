/* AGENTle Pass: UI owns presentation; server owns contracts, checks and AI access. */
const $ = id => document.getElementById(id);
const EXAMPLE = 'Build a small campus lost-and-found command-line tool as one Python file. Use only the Python standard library. Store records in a fixed lost_found.json file in the current folder. Each record has a title, description and location. Offer add, search, list and quit commands. Add asks for the three fields; search uses a case-insensitive substring across all fields; list prints every record. Start with an empty list if the file is missing and show a clear error if its JSON is invalid. Do not use external APIs. Do not add login. No timestamps or duplicate detection are needed. Use these defaults without asking about reversible preferences. We chose local storage so the tool works offline.';
let current = null, runToken = '', busy = false, healthy = false, epoch = 0, editing = false;
let motionPaused = false, focusReturn = null, pollPromise = null, invalidating = Promise.resolve(), codeDirty = false;
const errors = [];
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const rawBase = window.__API_BASE__ || '';
const unresolved = rawBase.startsWith('__PORT_');
const API = unresolved ? (local ? 'http://127.0.0.1:8000' : '') : rawBase.replace(/\/$/, '');
const ACTIVE = new Set(['researching', 'checking', 'repairing', 'coding', 'clarifying']);
setTimeout(() => document.body.classList.add('has-entered'), 800);

async function api(path, options = {}, credentials = null) {
  if (!API) throw new Error('The backend route is unavailable. Please reopen the updated app preview.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(API + path, {
      method: options.method || 'GET', credentials: 'same-origin', signal: controller.signal,
      headers: {'Content-Type': 'application/json', ...(credentials?.token ? {'X-Run-Token': credentials.token} : {})},
      ...(options.body !== undefined ? {body: JSON.stringify(options.body)} : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The backend took too long to respond. Your AI call may still be running; reset before trying again.');
    throw error;
  } finally { clearTimeout(timer); }
}
const creds = () => ({id: current?.id, token: runToken});
const runApi = (suffix, body) => api(`/api/runs/${current.id}${suffix}`, {method:'POST', ...(body !== undefined ? {body} : {})}, creds());
function textList(id, values) {
  $(id).replaceChildren();
  for (const value of values) { const li = document.createElement('li'); li.textContent = value; $(id).append(li); }
}
function feedback(el) {
  if (motionPaused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],
    {duration:320,easing:'cubic-bezier(.16,1,.3,1)'});
}
function syncPrompt() {
  const raw = $('prompt').value.trim(), count = raw ? raw.split(/\s+/).length : 0;
  $('prompt-count').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  $('visual-goal').textContent = raw ? raw.split(/(?<=[.!?])\s+|\n/)[0] : 'One task. All the context.';
  $('packet-visual').classList.toggle('has-context', !!raw);
  if (!current) {
    $('split-goal').textContent = 'Research will identify what you want to achieve.';
    $('split-rules').textContent = 'Research will extract requirements for you to review.';
    $('split-context').textContent = raw || 'Your original words, kept intact.';
    $('visual-rules').textContent = 'Research will find the rules';
    $('split-label').textContent = 'After Research runs';
  }
}
function stage(index, state = '') {
  const el = $('stage-' + index);
  el.className = 'stage' + (state ? ' ' + state : '');
  $('marker-' + index).textContent = state === 'done' ? '✓' : state === 'blocked' ? '!' : String(index + 1).padStart(2,'0');
  el.setAttribute('aria-label', `${el.querySelector('strong').textContent}: ${state || 'waiting'}`);
}
function freeze(on) {
  busy = on;
  for (const id of ['prompt','scenario','example']) $(id).disabled = on;
  $('run').disabled = on || !healthy;
  $('json').disabled = on || !current?.packet;
  $('validate').disabled = on;
  $('confirm-contract').disabled = on;
  for (const id of ['ask-sender','user-answer','save-code','recheck-code','inject-import']) $(id).disabled = on;
  $('skip').hidden = true;
}
function status(message, label, warning = false) {
  $('status').textContent = message;
  $('overall').textContent = label;
  $('overall').classList.toggle('warn', warning);
  $('status-dot').className = 'status-dot' + (warning ? ' warn' : busy ? ' working' : '');
}
function hideResult() {
  for (const id of ['empty-result','review','output','clarification']) $(id).hidden = true;
}
function showEmpty(title, message, badge) {
  hideResult(); $('empty-result').hidden = false;
  $('result').setAttribute('aria-labelledby','result-heading');
  $('result-heading').textContent = title;
  $('empty-result').querySelector('p').textContent = message;
  $('result-badge').textContent = badge;
}
function apply(run, writeJSON = true) {
  const previous = current?.phase;
  current = run;
  const phase = run.phase, packet = run.packet;
  const active = ACTIVE.has(phase) || run.comparison?.phase === 'running' || run.json_only?.phase === 'running';
  freeze(active);
  $('run').innerHTML = 'Start Research <span aria-hidden="true">↗</span>';
  $('path-0').className = 'connector' + (phase === 'researching' ? '' : ' done');
  $('path-1').className = 'connector' + (phase === 'coding' ? ' transferring' : phase === 'completed' ? ' done' : '');
  if (phase === 'researching' || phase === 'clarifying') { stage(0,'active'); stage(1); stage(2); }
  else if (phase === 'awaiting_confirmation') { stage(0,'done'); stage(1); stage(2); }
  else if (['checking','repairing'].includes(phase)) { stage(0,'done'); stage(1,'active'); stage(2); }
  else if (phase === 'coding') { stage(0,'done'); stage(1,'done'); stage(2,'active'); }
  else if (phase === 'completed') { stage(0,'done'); stage(1,'done'); stage(2,'done'); }
  else if (phase === 'checked') { stage(0,'done'); stage(1,'done'); stage(2); }
  else { stage(0,packet ? 'done' : 'blocked'); stage(1,'blocked'); stage(2,'blocked'); }
  const warning = ['needs_input','validation_failed','stale','error','cancelled'].includes(phase);
  document.body.dataset.runState = warning ? 'blocked' : phase === 'repairing' ? 'repairing' : phase === 'completed' ? 'ready' : active ? 'active' : 'idle';
  const labels = {researching:'Researching',clarifying:'Asking Research',interrupted:'Interrupted · saved',awaiting_confirmation:'Your review',checking:'Checking',repairing:'Repairing',coding:'Coding',completed:'File ready',needs_input:'Needs your input',stale:'Recheck required',checked:'Checks passed',validation_failed:'Validation failed',error:'Run stopped',cancelled:'Cancelled'};
  status(run.message, labels[phase] || phase, warning);
  $('visual-phase').textContent = {researching:'Research is analysing…',awaiting_confirmation:'Review before passing',checking:'Checking the packet…',repairing:'Repairing · then recheck',coding:'Coding from checked context…',completed:'Context carried. File ready.',checked:'Checked · ready for Coding'}[phase] || (warning ? 'Paused · inspect the issue' : 'Inspect the packet');
  if (packet) {
    $('split-goal').textContent = packet.goal || 'Invalid goal';
    $('split-rules').textContent = packet.constraints?.map(c=>c.text).join('\n') || 'No explicit requirements extracted. Check your original prompt.';
    $('split-context').textContent = run.prompt;
    $('split-label').textContent = !run.contract || run.pending_revision ? 'Proposed · review' : 'Server-held contract';
    $('visual-goal').textContent = packet.goal || run.prompt;
    $('visual-rules').textContent = `${packet.constraints?.length || 0} rules · ${!run.contract || run.pending_revision ? 'review before use' : run.receipt?.passed ? 'checked against contract' : 'recheck before use'}`;
  }
  renderDetails(writeJSON);
  renderEvidence();
  renderComparison();
  if (phase === 'awaiting_confirmation') renderReview();
  else if (phase === 'completed' && run.output) renderOutput();
  else if (phase === 'needs_input') renderQuestion();
  else if (phase === 'checked') {
    showEmpty('The handoff passed its checks.', 'Rechecking did not make an AI call. Open details and choose “Generate code again” when you are ready.', 'Checked, not generated');
  } else {
    const messages = {
      researching:['Research is doing the groundwork.','Extracting requirements and designing a small implementation from your supplied task.'],
      clarifying:['A focused question, not a fresh start.','Research is checking the supplied evidence. Coding remains paused.'],
      interrupted:['The evidence survived. The work is paused.','The server restarted during this run. No model call was automatically resumed. Inspect or export the saved evidence.'],
      checking:['The essentials get a checkpoint.','Coding waits until the confirmed contract and registered artifacts pass.'],
      repairing:['Caught before it reached Coding.','Restoring information already held by the server, then checking again.'],
      coding:['The next specialist has the context.','A separate Coding conversation is creating your Python file.'],
      stale:['The packet changed. Check it again.','Previous receipts and output no longer apply to this edited packet.'],
      validation_failed:['The handoff needs a correction.','Inspect the failed checks. Coding has not been allowed to continue.'],
      error:['This run stopped safely.',run.message],
      cancelled:['Run cancelled.','Already-sent provider requests may still count toward your NVIDIA usage.'],
    };
    const m = messages[phase] || ['The receiver is paused.',run.message];
    showEmpty(m[0],m[1],labels[phase] || 'Paused');
  }
  if (previous !== phase) feedback($('overall'));
}
function renderReview() {
  hideResult(); $('review').hidden = false;
  $('result').setAttribute('aria-labelledby','review-title');
  $('result-badge').textContent = 'Confirm the contract';
  const p = current.packet;
  const revision=$('revision-preview'); revision.replaceChildren(); revision.hidden=!current.pending_revision;
  const proposed=p.constraints.filter(r=>!r.quote_verified).length;
  const omissions=(current.coverage_hints||[]).filter(h=>h.status==='pending').length;
  const blocked=p.open_questions.some(q=>q.blocking);
  $('confirm-contract').textContent=blocked?'Answer the question to continue':current.pending_revision?'Approve updated task & code':proposed||omissions?'Approve all listed rules & code':'Looks right. Check & code ↗';
  $('review-approval-note').hidden=!blocked&&!proposed&&!omissions;
  $('review-approval-note').textContent=blocked?'A required answer is still missing. Use “Send my answer” below; Coding stays paused until it is resolved.':`${proposed} AI-proposed rule${proposed===1?'':'s'} and ${omissions} possible omission${omissions===1?'':'s'} need review. Approving adopts the proposals as your instructions and includes the hints shown below. You can still approve individually or dismiss a hint first.`;
  if(current.pending_revision){
    const heading=document.createElement('h3'); heading.textContent='Your answer changes the task. Review before approving.';
    revision.append(heading);
    for(const change of current.pending_revision.changes){
      const line=document.createElement('p');
      line.textContent=change.kind==='retire_rule'?`Remove old instruction: ${change.rule.text}`:
        change.kind==='add_rule'?`Add instruction: ${change.rule.text}`:`Updated goal: ${change.after}`;
      const quote=document.createElement('p'); quote.className='caveat';
      quote.textContent=`Based on your answer: “${change.source_quote}”`;
      revision.append(line,quote);
    }
    const note=document.createElement('p'); note.className='caveat';
    note.textContent='Old instructions stay in the audit history. Coding remains paused until you approve this updated task.';
    revision.append(note);
  }
  $('review-goal').textContent = p.goal;
  $('review-rules').replaceChildren();
  for (const rule of p.constraints) {
    const li=document.createElement('li'); li.className='review-rule'; li.append(document.createTextNode(rule.text));
    const button=document.createElement('button'); button.type='button'; button.className='text-button';
    button.textContent=rule.quote_verified?'View source':'AI proposal · approve individually';
    button.onclick=()=>rule.quote_verified?showSource(rule):action('/rule-clarification',{rule_id:rule.id});
    li.append(button); $('review-rules').append(li);
  }
  const hints=$('coverage-hints'); hints.replaceChildren();
  const pending=(current.coverage_hints||[]).filter(h=>h.status==='pending');
  if(pending.length){
    const title=document.createElement('p'); title.textContent='Possible missing instructions. Approval includes these unless you dismiss them first.'; hints.append(title);
    for(const hint of pending){
      const row=document.createElement('div'); row.className='hint-row';
      const text=document.createElement('p'); text.textContent=hint.text; row.append(text);
      for(const choice of ['include','dismiss']){
        const button=document.createElement('button'); button.type='button'; button.className='text-button';
        button.textContent=choice==='include'?'Include rule':'Dismiss hint'; button.onclick=()=>action('/coverage',{hint_id:hint.id,action:choice}); row.append(button);
      } hints.append(row);
    }
  }
  $('sender-budget').textContent=`${current.correction_rounds||0} / 2 sender correction rounds used. Format corrections count toward this budget.`;
  $('user-answer').disabled=busy||(current.correction_rounds||0)>=2;
  $('ask-sender').disabled=busy||(current.correction_rounds||0)>=2;
  if(p.open_questions.some(q=>q.blocking)) $('sender-tools').open=true;
  $('review-questions').textContent = p.open_questions.length ? p.open_questions.map(q=>`${q.blocking ? 'Needs an answer' : 'Open note'}: ${q.question}`).join('\n') : 'No essential unanswered questions identified. Review the rules for anything Research missed.';
  $('review-findings').textContent = p.artifacts.find(a=>a.type === 'research_findings')?.content || '';
}
function renderOutput() {
  hideResult(); $('output').hidden = false;
  $('result').setAttribute('aria-labelledby','output-title');
  $('result-badge').textContent = 'Generated · not executed';
  $('output-title').textContent = 'Your Python file is ready.';
  const out = current.output, target = $('output-content'); target.replaceChildren();
  const fresh=out.fresh && !codeDirty;
  const caveat = document.createElement('p'); caveat.className = 'output-caveat';
  caveat.textContent = fresh ? `${out.static_failures} static check failures · ${out.manual_rules} rules need manual review. ${out.runtime}` : 'Stale output evidence. Code or checked inputs changed; save and recheck before using an earlier verdict.';
  const pre = document.createElement('pre'); pre.className = 'generated-code'; pre.tabIndex = 0;
  pre.setAttribute('aria-label','Generated Python source'); pre.textContent = out.code;
  target.append(caveat,pre);
  const details = document.createElement('details'), summary = document.createElement('summary'), ul = document.createElement('ul');
  summary.textContent = 'Inspect output checks'; ul.className = 'check-list';
  for (const check of out.checks) {
    const li = document.createElement('li'); li.className = fresh && check.ok ? 'pass' : 'fail';
    li.textContent = `${!fresh ? 'Stale' : check.ok ? 'Pass' : 'Fail'}: ${check.name}. ${check.detail}`; ul.append(li);
  }
  details.append(summary,ul); target.append(details);
  $('notes-receipt').replaceChildren();
  for (const [label,count] of [['Reasons',current.packet.decisions_made.length],['Actual attempts',current.packet.attempts.length]]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'note-chip';
    button.textContent = `${label} · ${count}`; button.onclick = ()=>openDialog('details-dialog'); $('notes-receipt').append(button);
  }
  $('receipt').textContent = `${current.checks.filter(c=>c.ok).length} handoff checks passed · ${current.model_calls.length} completed AI calls`;
  if(!codeDirty) $('code-editor').value=out.code;
  $('code-freshness').textContent=codeDirty?'Unsaved edit: previous evidence does not cover this draft.':fresh?`Current evidence · code version ${current.code_version||1} · contract version ${current.contract_version||1}`:'Stale: the old check applies to different inputs. Recheck the current code.';
  $('code-freshness').className='caveat'+(fresh?'':' stale');
  $('recheck-code').disabled=busy||codeDirty;
}
function renderQuestion() {
  hideResult(); $('clarification').hidden = false;
  $('result').setAttribute('aria-labelledby','clarification-title');
  $('result-badge').textContent = 'Coding has not run';
  $('clarification-prompt').textContent = current.message;
  $('answer-label').textContent = current.expected_answer?'Confirm the registered ID shown above':'Your explicit answer to the missing detail';
  $('answer').placeholder = current.expected_answer || 'Answer only what you know; the new version needs review.';
  const exhausted=!current.expected_answer && (current.correction_rounds||0)>=2;
  $('clarification').querySelector('button[type=submit]').disabled=exhausted;
  $('clarification').querySelector('button[type=submit]').textContent=current.expected_answer?'Confirm & recheck':'Send my answer';
  if(exhausted) $('clarification-prompt').textContent+=' Two correction rounds are used. Edit your original prompt and start a new run.';
}
function renderDetails(writeJSON = true) {
  const p = current?.packet;
  $('drawer-status').textContent = current ? `${current.task_id} · ${current.phase.replaceAll('_',' ')} · NVIDIA` : 'No run yet';
  $('detail-goal').textContent = p?.goal || 'Describe your task and start Research.';
  $('detail-rules').replaceChildren();
  for(const rule of p?.constraints||[]){
    const li=document.createElement('li'), button=document.createElement('button');
    button.type='button'; button.className='source-link'; button.textContent=`${rule.id} · ${rule.text} ↗`; button.onclick=()=>showSource(rule);
    li.append(button); $('detail-rules').append(li);
  }
  $('detail-artifacts').textContent = p?.artifacts?.map(a=>`${a.type === 'research_findings' ? 'Research findings' : 'Your original prompt'}\n${a.content}\nSource: ${a.source_refs.join(', ')}\nSHA-256: ${a.sha256}`).join('\n\n') || 'Your supplied prompt and actual Research analysis will appear here.';
  const notes = (id,arr,format,empty) => {
    $(id).replaceChildren();
    for (const note of arr?.length ? arr.map(format) : [empty]) { const e = document.createElement('p'); e.textContent = note; $(id).append(e); }
  };
  notes('detail-decisions',p?.decisions_made,d=>`${d.decision}\nWhy: ${d.reason}\n${d.origin === 'user_input' ? 'User-provided' : 'Agent proposal, not user-approved'}${d.source_quote ? '\nSource quote: ' + d.source_quote : ''}`,'No decision notes recorded.');
  notes('detail-attempts',p?.attempts,a=>`${a.action}\nResult: ${a.result}\nConditions: ${a.conditions}\nEvidence: ${a.evidence}\nOrigin: ${a.origin}`,'No actual previous attempts recorded.');
  $('detail-questions').textContent = p?.open_questions?.length ? p.open_questions.map(q=>`${q.blocking ? 'Blocking' : 'Non-blocking'}: ${q.question}`).join('\n') : 'No questions recorded.';
  textList('activity',current?.events?.length ? current.events : ['No activity yet.']);
  $('check-list').replaceChildren();
  const stale = editing || current?.phase === 'stale';
  for (const c of current?.checks || []) {
    const li = document.createElement('li'); li.className = stale || !c.ok ? 'fail' : 'pass';
    li.textContent = `${stale ? 'Stale' : c.ok ? 'Pass' : 'Fail'}: ${c.name}. ${c.detail}`;
    $('check-list').append(li);
  }
  if (!$('check-list').children.length) textList('check-list',['No checkpoint checks run yet.']);
  if (writeJSON && !editing) $('json').value = current?.raw_packet || '{}';
  $('regenerate').hidden = current?.phase !== 'checked';
  $('hash-receipt').textContent = current?.receipt && !stale ? `Receipt bound to packet SHA-256 ${current.receipt.packet_sha256}. Checker: ${current.receipt.checker_version}.` : 'No current accepted receipt.';
  $('model-details').textContent = current?.model_calls?.map(c=>`${c.role}${c.mode ? ' / ' + c.mode : ''}: requested ${c.requested_model}; provider returned ${c.returned_model}; temperature ${c.temperature}; ${c.seconds}s; tokens ${c.usage?.total_tokens ?? 'not supplied'}; HTTP attempts ${c.http_attempts}.`).join('\n') || 'No completed model calls yet.';
  $('record-list').replaceChildren();
  const records=current?.check_records||[], latestOutput=records.filter(r=>r.kind==='output').at(-1);
  for(const record of records.slice(-8).reverse()){
    const card=document.createElement('article'),title=document.createElement('strong'),body=document.createElement('p');
    const old=!record.fresh || (record.kind==='output'&&(record.id!==latestOutput?.id||!current.output?.fresh||codeDirty));
    card.className=old?'stale':'';
    title.textContent=`${record.id} · ${old?'Stale':record.result} · ${record.kind}`;
    body.textContent=`Contract v${record.contract_version} · ${record.checker_version}\n${record.checked_at}\n${Object.entries(record.inputs).map(([key,hash])=>`${key}: ${hash.slice(0,16)}…`).join('\n')}`;
    body.style.whiteSpace='pre-wrap'; card.append(title,body); $('record-list').append(card);
  }
  for(const id of ['resume-brief','export-evidence']) $(id).disabled=!current?.packet;
}
function renderEvidence() {
  $('evidence').hidden = !current?.packet;
  if (!current?.packet) return;
  const p = current.packet, checks = current.checks, stale = editing || current.phase === 'stale';
  const confirmed = !!current.contract && !current.pending_revision;
  const state = stale ? 'Stale · recheck required' : !checks.length ? 'Awaiting your review' : checks.some(c=>!c.ok) ? 'Needs attention' : 'Handoff checks passed';
  $('evidence-state').textContent = state;
  $('evidence-state').className = 'evidence-state' + (stale || checks.some(c=>!c.ok) ? ' attention' : checks.length ? ' accepted' : '');
  $('check-evidence-count').textContent = stale ? 'Recheck required' : checks.length ? `${checks.filter(c=>c.ok).length} / ${checks.length} passed` : 'Not checked yet';
  $('note-evidence-count').textContent = `${p.decisions_made?.length || 0} reasons · ${p.attempts?.length || 0} attempts`;
  $('source-evidence-state').textContent = stale ? 'Edited · needs recheck' : checks.find(c=>c.name === 'Registered source and findings')?.ok === false ? 'Missing or changed' : 'Original + Research attached';
  const rows = $('rule-rows'); rows.replaceChildren();
  const researchRules = current.output?.rules || [];
  const rules = current.rejected_checks?.length && current.phase === 'needs_input' ? (current.packet.constraints || []) : (p.constraints || []);
  for (const rule of rules) {
    const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td'), c = document.createElement('td');
    const sourceButton=document.createElement('button'); sourceButton.type='button'; sourceButton.className='source-link';
    sourceButton.textContent=rule.text+' ↗'; sourceButton.onclick=()=>showSource(rule); a.append(sourceButton);
    const badge = document.createElement('span');
    const retained = !checks.some(x=>x.name === 'Confirmed goal and rules' && !x.ok);
    badge.className = 'rule-status' + (stale || !retained ? ' attention' : confirmed && checks.length ? ' accepted' : '');
    badge.textContent = stale ? 'Recheck' : !confirmed ? 'Review' : !checks.length ? 'Pending' : retained ? 'Present' : 'Changed / missing';
    b.append(badge);
    const out = researchRules.find(x=>x.id === rule.id);
    c.textContent = stale || codeDirty || (current.output && !current.output.fresh) ? 'Stale' : out ? out.status === 'manual' ? 'Manual review' : out.status === 'pass' ? 'Pass · static only' : 'Fail · static' : 'Not run';
    if (out) c.title = out.detail;
    tr.append(a,b,c); rows.append(tr);
  }
  if (!rows.children.length) {
    const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 3;
    td.textContent = 'No explicit rules extracted. Review the original task before confirming.'; tr.append(td); rows.append(tr);
  }
}
function comparisonQuestion(comp) {
  const prefix='Plain-text receiver requested clarification: ';
  return comp?.question || (comp?.message?.startsWith(prefix)?comp.message.slice(prefix.length):'');
}
function renderComparison() {
  const comp = current?.comparison, ours = current?.output, plain = comp?.plain_text;
  const question=comparisonQuestion(comp), answers=comp?.answers||[];
  $('run-comparison').disabled = !ours?.fresh || codeDirty || current.phase !== 'completed' || current.scenario !== 'valid' || busy || ['running','completed','needs_input','clarification_limit'].includes(comp?.phase) || !!question;
  $('comparison-status').textContent = comp?.phase === 'running' ? 'Creating the plain-text result…' : plain ? 'Comparison ready. See both results below.' : question ? (comp?.finish_requested?'The receiver still needs essential information. Its incomplete result is shown below.':'The receiver has a question. Answer it, or finish with sensible defaults.') : comp?.message || (current?.scenario && current.scenario !== 'valid' ? 'Use a clean run to compare results.' : 'Finish your task, then compare its handoff with plain text.');
  $('comparison-clarification').hidden=!(question && !comp?.finish_requested && ['needs_input','error'].includes(comp?.phase) && answers.length<2);
  $('comparison-question').textContent=question;
  if($('comparison-clarification').dataset.question!==question){
    $('comparison-answer').value=''; $('comparison-clarification').dataset.question=question;
  }
  $('comparison-refresh-checks').hidden=!question || !!ours?.fresh;
  $('comparison-refresh-checks').disabled=busy || codeDirty;
  $('continue-comparison').disabled=busy || codeDirty || !ours?.fresh;
  $('plain-column').textContent=answers.length?'Plain text (assisted)':'Plain text';
  $('finish-comparison').hidden=!question || !!comp?.finish_requested || comp?.phase==='running' || !!plain;
  $('finish-comparison').disabled=busy || codeDirty || !ours?.fresh;
  $('comparison-call-note').textContent=answers.length?'Plain text includes your answers.':question&&!comp?.finish_requested?'Finish with defaults makes one final AI call, without overriding your rules.':'Static checks only. Generated code is not run.';
  const outcome=plain?'Code ready':comp?.phase==='running'?'Running…':question?'Needs details':comp?.phase==='error'?'Unavailable':'Not run yet';
  const rows = [
    ['Result', outcome, ours?.fresh?'Code ready':ours?'Recheck needed':'Not run yet'],
    ['Check failures', plain?.static_failures ?? 'No code yet', ours?.fresh?ours?.static_failures:'—'],
    ['Rules to review', plain?.manual_rules ?? '—', ours?.manual_rules ?? '—'],
    ['Coding time (seconds)', plain?.model?.seconds ?? '—', ours?.model?.seconds ?? '—'],
  ];
  const body = $('comparison-rows'); body.replaceChildren();
  for (const values of rows) {
    const row = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value ?? 'Not measured'; row.append(td); } body.append(row);
  }
  $('baseline-details').hidden = !plain;
  $('baseline-code').textContent = plain?.code || '';
}
async function poll(myEpoch) {
  const saved = creds(), started = Date.now();
  while (myEpoch === epoch) {
    try {
      const state = await api(`/api/runs/${saved.id}`,{},saved);
      if (myEpoch !== epoch) return;
      apply(state);
      if (!ACTIVE.has(state.phase) && state.comparison?.phase !== 'running' && state.json_only?.phase !== 'running') return;
      if (Date.now() - started > 600000) throw new Error('The run is taking too long. Reset to cancel it before retrying.');
      await new Promise(resolve=>setTimeout(resolve,1000));
    } catch (error) {
      if (myEpoch === epoch) { freeze(false); status(error.message,'Connection interrupted',true); errors.push(error.message); }
      return;
    }
  }
}
function startPolling() { pollPromise = poll(epoch); }
async function action(suffix, body) {
  const myEpoch = epoch;
  try {
    freeze(true);
    const state = await runApi(suffix,body);
    if (myEpoch !== epoch) return;
    editing = false; apply(state); startPolling();
  } catch (error) {
    if (myEpoch !== epoch) return;
    freeze(false); status(error.message,'Needs attention',true);
    if ($('details-dialog').open) $('validation').textContent = error.message;
    else if ($('compare-dialog').open) $('comparison-answer-error').textContent = error.message;
    else if (!$('clarification').hidden) $('answer-error').textContent = error.message;
  }
}
function clear(cancel = true) {
  const old = current && creds();
  epoch++; current = null; runToken = ''; editing = false; busy = false; codeDirty=false;
  $('source-quote-panel').hidden=true;
  if (cancel && old) api(`/api/runs/${old.id}/cancel`,{method:'POST'},old).catch(()=>{});
  for (let i=0;i<3;i++) stage(i);
  for (let i=0;i<2;i++) $('path-'+i).className = 'connector';
  document.body.dataset.runState = 'idle';
  $('visual-phase').textContent = 'Inspect the packet';
  $('evidence').hidden = true; $('validation').textContent = ''; $('answer-error').textContent = '';
  $('answer').value=''; $('sender-question').value=''; $('comparison-answer').value=''; $('comparison-answer-error').textContent='';
  $('regenerate').hidden = true; freeze(false);
  status('Describe a small Python tool, then let Research prepare the handoff.','Ready when you are');
  showEmpty('A good handoff starts here.','The next specialist gets the context, not just a message.','Waiting for context');
  syncPrompt(); renderDetails(true); renderComparison();
}
$('task-form').addEventListener('submit',async e=>{
  e.preventDefault(); if (busy || !healthy) return;
  const prompt = $('prompt').value.trim();
  $('form-error').hidden = true;
  if (prompt.length < 8) { $('form-error').textContent = 'Describe a small Python task in a little more detail, or try the example.'; $('form-error').hidden = false; $('prompt').focus(); return; }
  clear(); const myEpoch = epoch; freeze(true);
  status('Starting the real Research specialist…','Connecting');
  try {
    const state = await api('/api/runs',{method:'POST',body:{prompt,scenario:$('scenario').value}});
    if (myEpoch !== epoch) {
      await api(`/api/runs/${state.id}/cancel`,{method:'POST'},{token:state.run_token}); return;
    }
    runToken = state.run_token; delete state.run_token; apply(state); startPolling();
  } catch (error) {
    if (myEpoch !== epoch) return;
    freeze(false); status(error.message,'Could not start',true);
    $('form-error').textContent = error.message; $('form-error').hidden = false;
  }
});
$('confirm-contract').onclick = ()=>{
  if(current?.packet?.open_questions?.some(q=>q.blocking)){
    $('sender-tools').open=true; $('sender-question').focus();
    $('sender-tools').scrollIntoView({behavior:motionPaused?'auto':'smooth',block:'center'}); return;
  }
  const accept_review=!!current?.packet?.constraints?.some(r=>!r.quote_verified)||!!current?.coverage_hints?.some(h=>h.status==='pending');
  action('/confirm',{accept:true,accept_changes:!!current?.pending_revision,accept_review});
};
$('comparison-clarification').addEventListener('submit',e=>{
  e.preventDefault(); if(busy)return;
  const answer=$('comparison-answer').value.trim();
  $('comparison-answer-error').textContent='';
  if(!answer){$('comparison-answer-error').textContent='Type your answer before continuing.';return;}
  action('/compare/answer',{answer});
});
$('comparison-refresh-checks').onclick=()=>action('/code/recheck');
$('ask-sender').onclick=()=>{const question=$('sender-question').value.trim(); if(question.length>=3) action('/ask-sender',{question}); else $('sender-budget').textContent='Type one specific question first.';};
$('user-answer').onclick=()=>{const answer=$('sender-question').value.trim(); if(answer) action('/answer',{answer}); else $('sender-budget').textContent='Type your explicit answer first.';};
$('revise').onclick = ()=>{ clear(); $('prompt').focus(); };
$('revise-blocked').onclick=()=>{clear();$('prompt').focus();$('prompt').scrollIntoView({block:'center'});};
$('clarification').addEventListener('submit',e=>{
  e.preventDefault(); if (busy) return; $('answer-error').textContent = '';
  const answer = $('answer').value.trim();
  if (!answer) { $('answer-error').textContent = current.expected_answer?'Enter the registered ID shown above.':'Enter your answer first. Coding remains paused.'; return; }
  action('/answer',{answer});
});
$('validate').onclick = async ()=>{
  if (!current || busy) { $('validation').textContent = 'Run Research and confirm its contract before editing the handoff.'; return; }
  try {
    await invalidating; const state = await runApi('/recheck',{raw:$('json').value});
    editing = false; apply(state,false);
    $('validation').textContent = state.message;
  } catch (error) { $('validation').textContent = error.message; }
};
$('regenerate').onclick = ()=>action('/generate');
$('run-comparison').onclick = ()=>action('/compare');
$('finish-comparison').onclick=()=>action('/compare/finish');
$('code-editor').oninput=()=>{codeDirty=true; renderOutput(); renderEvidence(); renderComparison();};
$('save-code').onclick=()=>{const code=$('code-editor').value; codeDirty=false; action('/code',{code});};
$('recheck-code').onclick=()=>action('/code/recheck');
$('inject-import').onclick=()=>{codeDirty=false; action('/code',{code:'import requests\n'+current.output.code});};
$('json').addEventListener('input',()=>{
  if (!current || busy || current.phase === 'awaiting_confirmation' || editing) return;
  editing = true;
  current.phase = 'stale'; current.output = null; current.comparison = null; current.receipt = null;
  apply(current,false);
  $('validation').textContent = 'Edited packet: earlier receipts and output are stale. Check this packet before generating again.';
  invalidating = runApi('/invalidate').catch(error=>{ $('validation').textContent = error.message; });
});
function openDialog(id) {
  focusReturn = document.activeElement;
  if (id === 'details-dialog') renderDetails(!editing);
  if (id === 'compare-dialog') renderComparison();
  if (!$(id).open) $(id).showModal();
  document.body.style.overflow = 'hidden';
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close',()=>{ document.body.style.overflow = ''; if (focusReturn?.isConnected) focusReturn.focus(); });
  dialog.addEventListener('click',e=>{ if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
}
for (const b of document.querySelectorAll('[data-close]')) b.onclick = ()=>$(b.dataset.close).close();
for (const b of document.querySelectorAll('[data-stage]')) b.onclick = ()=>openDialog('details-dialog');
$('inspect').onclick = $('packet-visual').onclick = ()=>openDialog('details-dialog');
$('compare').onclick = ()=>openDialog('compare-dialog');
$('help').onclick = ()=>openDialog('help-dialog');
$('source-evidence').onclick = ()=>{ openDialog('details-dialog'); $('detail-artifacts').scrollIntoView({block:'center'}); };
$('check-evidence').onclick = ()=>{ openDialog('details-dialog'); $('check-list').parentElement.open = true; $('check-list').scrollIntoView({block:'center'}); };
$('note-evidence').onclick = ()=>{ openDialog('details-dialog'); $('detail-decisions').scrollIntoView({block:'center'}); };
$('prompt').addEventListener('input',()=>{ if (current) clear(); syncPrompt(); $('form-error').hidden = true; });
$('prompt').addEventListener('keydown',e=>{ if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (!busy) $('task-form').requestSubmit(); } });
$('example').onclick = ()=>{ clear(); $('prompt').value = EXAMPLE; $('scenario').value = 'valid'; syncPrompt(); $('prompt').focus(); feedback(document.querySelector('.paper-front')); };
$('reset').onclick = ()=>{ clear(); $('form-error').hidden = true; $('demo-controls').open = false; };
$('scenario').onchange = ()=>clear();
$('motion-toggle').onclick = ()=>{
  motionPaused = !motionPaused; document.documentElement.classList.toggle('motion-paused',motionPaused);
  $('motion-toggle').setAttribute('aria-pressed',String(motionPaused));
  $('motion-toggle').textContent = motionPaused ? 'Resume motion' : 'Pause motion';
  if (motionPaused) for (const a of document.getAnimations()) a.cancel();
};
function download(value,filename,type) {
  const url = URL.createObjectURL(new Blob([value],{type})), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function copy(value,button,fallback) {
  const old = button.textContent;
  try { await navigator.clipboard.writeText(value); button.textContent = 'Copied'; }
  catch {
    if (fallback) { fallback.focus(); fallback.select(); }
    else {
      const pre = document.querySelector('#output-content pre');
      if (pre) { const range = document.createRange(); range.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
    }
    button.textContent = 'Selected · copy manually';
  }
  setTimeout(()=>button.textContent = old,2000);
}
$('copy').onclick = ()=>copy($('json').value,$('copy'),$('json'));
$('copy-output').onclick = ()=>copy(current?.output?.code || '',$('copy-output'));
$('download').onclick = ()=>download($('json').value,'agentle-pass-handoff.json','application/json');
$('download-code').onclick = ()=>download(current.output.code,'agentle_result.py','text/x-python');
$('download-baseline').onclick = ()=>download(current.comparison.plain_text.code,'plain_text_result.py','text/x-python');
function showSource(rule){
  openDialog('details-dialog'); const source=current.packet.sources?.find(s=>s.id===rule.source_id);
  $('source-quote-panel').hidden=false; $('source-quote-title').textContent=`${rule.id} · ${rule.quote_verified?'Verified quote':'Unverified proposal'}`;
  $('source-quote-text').textContent=rule.source_quote||'No verified quote. Explicit user clarification is needed.';
  $('source-quote-authority').textContent=source?`${source.id} · ${source.kind} · ${source.instruction_authority} · version ${source.version}. A quote match does not prove interpretation or truth.`:'Source not registered.';
  $('source-quote-panel').scrollIntoView({block:'center'});
}
$('export-evidence').onclick=async()=>{if(!current)return; try{const data=await api(`/api/runs/${current.id}/evidence`,{},creds());download(JSON.stringify(data,null,2),'agentle-pass-evidence.json','application/json');}catch(e){$('validation').textContent=e.message;}};
$('resume-brief').onclick=async()=>{if(!current)return;try{const data=await api(`/api/runs/${current.id}/resume-brief`,{},creds());download(data.text,'agentle-pass-resume.txt','text/plain');}catch(e){$('validation').textContent=e.message;}};
$('history').onclick=async()=>{
  openDialog('history-dialog'); const list=$('history-list'); list.textContent='Loading private saved evidence…';
  try{
    const data=await api('/api/history'); list.replaceChildren();
    if(!data.runs.length) list.textContent='No saved runs yet. Start Research to create one.';
    for(const saved of data.runs){
      const button=document.createElement('button'); button.type='button';
      button.textContent=`${saved.goal}\n${saved.phase} · contract v${saved.version} · ${saved.created_at}`;
      button.onclick=async()=>{try{clear(false);const result=await api(`/api/history/${saved.id}/open`,{method:'POST'});runToken=result.run_token;delete result.run_token;$('prompt').value=result.prompt||'';syncPrompt();apply(result);$('history-dialog').close();if(ACTIVE.has(result.phase))startPolling();}catch(e){list.textContent=e.message;}};
      list.append(button);
    }
  }catch(e){list.textContent=e.message;}
};
clear(false);
api('/api/health').then(data=>{
  healthy = data.ok && data.configured;
  $('connection-badge').innerHTML = '<i></i>' + (healthy ? 'NVIDIA connected' : 'NVIDIA not configured');
  $('connection-help').textContent = healthy ? 'Two real specialists. One NVIDIA model. Supplied notes only.' : 'Backend is reachable, but its secure NVIDIA access needs configuring.';
  freeze(false);
}).catch(error=>{
  healthy = false; $('connection-badge').textContent = 'Backend unavailable';
  $('connection-help').textContent = error.message; freeze(false);
});
