import test from 'node:test';
import assert from 'node:assert/strict';
import {runPascal} from '../dist/pascal.js';

const sum = `program SumArray;
const limit = 100;
var a: array[1..limit] of integer;
    n, i, s: integer;
begin
  readln(n);
  for i := 1 to n do read(a[i]);
  s := 0;
  for i := 1 to n do s := s + a[i];
  writeln(s)
end.`;

test('array program runs on varied inputs and preserves state', () => {
  for(const [input, expected] of [['5\n3 -2 7 0 1','9\n'],['1\n-42','-42\n'],['3 0 0 0','0\n']]) {
    const r = runPascal(sum,input); assert.equal(r.output,expected); assert.ok(r.steps > 0); assert.equal(r.variables.a.low,1);
  }
});
test('count matching elements, Pascal boolean precedence and modulo', () => {
  const p=`var a: array[1..5] of integer; i,k: integer; begin k:=0; for i:=1 to 5 do begin read(a[i]); if (a[i] > 0) and (a[i] mod 2 = 0) then inc(k) end; writeln(k) end.`;
  assert.equal(runPascal(p,'2 -4 0 8 7').output,'2\n');
});
test('first maximum handles negative values and repeated extrema', () => {
  const p=`var a: array[1..100] of integer; n,i,m,p: integer; begin read(n); for i:=1 to n do read(a[i]); m:=a[1]; p:=1; for i:=2 to n do if a[i]>m then begin m:=a[i]; p:=i end; writeln(m,' ',p) end.`;
  assert.equal(runPascal(p,'4 -5 -2 -2 -10').output,'-2 2\n');
  assert.equal(runPascal(p,'1 -8').output,'-8 1\n');
  assert.equal(runPascal('var max,min:integer; begin max:=-2; min:=-10; writeln(max-min) end.').output,'8\n');
});
test('if else binds to nearest if and supports nested blocks', () => {
  assert.equal(runPascal(`var x: integer; begin x:=2; if x>0 then if x=1 then write('one') else write('two') end.`).output,'two');
});
test('while search short circuits before bounds access', () => {
  const p=`var a:array[1..3] of integer; i:integer; begin for i:=1 to 3 do a[i]:=i; i:=1; while (i<=3) and (a[i]<>9) do i:=i+1; if i<=3 then write(i) else write(0) end.`;
  assert.equal(runPascal(p).output,'0');
});
test('downto, repeat, break and exit', () => {
  const p=`var i,s:integer; begin s:=0; for i:=5 downto 1 do begin if i=2 then break; s:=s+i end; repeat s:=s-1 until s=10; writeln(s); exit; write('no') end.`;
  assert.equal(runPascal(p).output,'10\n');
});
test('PascalABC for var scopes loop variable and typed initialized variables work', () => {
  const p=`var s:integer:=0; i:integer:=99; begin for var i:=1 to 4 do s:=s+i; writeln(s,' ',i); for var k:=2 downto 1 do write(k) end.`;
  const result=runPascal(p);
  assert.equal(result.output,'10 99\n21');
  assert.equal(result.variables.i,99);
  assert.equal(result.variables.k,undefined);
});
test('typed constant array, negative lower bound, initialization and functions', () => {
  const p=`const a:array[-1..1] of integer=(-3,2,5); var x:=sqrt(9); begin writeln(abs(a[-1])+sqr(a[0])); writeln(low(a),' ',high(a),' ',length(a)); writeln(x:0:2) end.`;
  assert.equal(runPascal(p).output,'7\n-1 1 3\n3.00\n');
});
test('comments, escaped quotes and case insensitive identifiers', () => {
  assert.equal(runPascal(`PROGRAM Demo; {comment\n} VAR X: integer; BEGIN (*hi*) X:=7 DIV 2; //line\n WriteLn('it''s ',x) END.`).output,"it's 3\n");
});
test('expressions and input are not evaluated as JS', () => {
  assert.throws(()=>runPascal('begin writeln(alert(1)) end.'),/не поддерживается/);
  assert.throws(()=>runPascal(sum,'1 globalThis.x=9'),/не является числом/);
  assert.throws(()=>runPascal('begin `hi` end.'),/Неизвестный символ/);
});
test('meaningful bounds, syntax, declaration and input errors with line numbers', () => {
  for(const [source,input,pattern] of [
    ['var a:array[1..3] of integer; begin a[0]:=1 end.','',/Строка 1: Индекс 0 вне границ/],
    ['begin\nx:=1\nend.','',/Строка 2: Переменная «x» не объявлена/],
    ['var x:integer; begin read(x) end.','',/Закончились входные данные/],
    ['var x:integer; begin read(x) end.','1.2',/целое число/],
    ['begin write(1/0) end.','',/Деление на ноль/],
    ['begin write(1) write(2) end.','',/точка с запятой/],
    ['begin if true then write(1); else write(2) end.','',/Ожидается имя переменной/],
    ['begin write(1) end','',/Ожидается «.»/],
    ['begin (*open','',/Комментарий не закрыт/],
    ['begin break end.','',/только внутри цикла/],
    ['const n=3; begin n:=4 end.','',/Нельзя изменять константу/],
  ]) assert.throws(()=>runPascal(source,input),pattern);
});
test('infinite loops and excessive output are bounded', () => {
  assert.throws(()=>runPascal('begin while true do begin end end.','',{maxSteps:100}),/лимит шагов/);
  assert.throws(()=>runPascal(`var i:integer; begin for i:=1 to 100000 do write('1234567890') end.`),/Слишком много вывода/);
  assert.throws(()=>runPascal('var a,b,c:array[1..100000] of integer; begin end.'),/Суммарно/);
});
