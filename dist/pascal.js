/* A small, deterministic Pascal teaching interpreter. It never evaluates JS source. */
const BUILTINS = new Set(['abs', 'sqr', 'sqrt', 'round', 'trunc', 'length', 'low', 'high', 'odd', 'min', 'max', 'ord']);
const TYPES = new Set(['integer', 'longint', 'int64', 'real', 'double', 'boolean', 'string', 'char', 'byte']);

function fail(message, line = 1) {
  throw new Error(`Строка ${line}: ${message}`);
}

function tokenize(source) {
  const tokens = [];
  let pos = 0, line = 1;
  const put = (kind, value, at = line) => tokens.push({kind, value, line: at});
  while (pos < source.length) {
    const c = source[pos], next = source[pos + 1];
    if (/\s/.test(c)) { if (c === '\n') line++; pos++; continue; }
    if (c === '/' && next === '/') {
      while (pos < source.length && source[pos] !== '\n') pos++;
      continue;
    }
    if (c === '{' || (c === '(' && next === '*')) {
      const start = line, closing = c === '{' ? '}' : '*)';
      pos += c === '{' ? 1 : 2;
      while (pos < source.length && !source.startsWith(closing, pos)) {
        if (source[pos++] === '\n') line++;
      }
      if (pos >= source.length) fail('Комментарий не закрыт.', start);
      pos += closing.length;
      continue;
    }
    if (c === "'") {
      const start = line;
      let value = ''; pos++;
      let closed = false;
      while (pos < source.length) {
        if (source[pos] === "'") {
          pos++;
          if (source[pos] === "'") { value += "'"; pos++; }
          else { closed = true; break; }
        } else {
          if (source[pos] === '\n') fail('Строка в кавычках не закрыта.', start);
          value += source[pos++];
        }
      }
      if (!closed) fail('Строка в кавычках не закрыта.', start);
      put('string', value, start); continue;
    }
    if (/[0-9]/.test(c)) {
      const start = pos;
      while (/[0-9]/.test(source[pos] || '')) pos++;
      if (source[pos] === '.' && source[pos + 1] !== '.' && /[0-9]/.test(source[pos + 1] || '')) {
        pos++; while (/[0-9]/.test(source[pos] || '')) pos++;
      }
      if (/[eE]/.test(source[pos] || '')) {
        pos++;
        if (/[+-]/.test(source[pos] || '')) pos++;
        if (!/[0-9]/.test(source[pos] || '')) fail('После e нужен показатель степени.', line);
        while (/[0-9]/.test(source[pos] || '')) pos++;
      }
      const value = Number(source.slice(start, pos));
      if (!Number.isFinite(value)) fail('Слишком большое число.', line);
      put('number', value); continue;
    }
    if (/[A-Za-z_А-Яа-яЁё]/.test(c)) {
      const start = pos++;
      while (/[A-Za-z_А-Яа-яЁё0-9]/.test(source[pos] || '')) pos++;
      put('id', source.slice(start, pos).toLowerCase()); continue;
    }
    const two = source.slice(pos, pos + 2);
    if ([':=', '..', '<=', '>=', '<>'].includes(two)) { put('symbol', two); pos += 2; continue; }
    if ('+-*/=<>;:,().[]'.includes(c)) { put('symbol', c); pos++; continue; }
    fail(`Неизвестный символ «${c}».`, line);
  }
  put('eof', '<конец программы>');
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; this.depth = 0; }
  get current() { return this.tokens[this.pos]; }
  is(value) { return this.current.value === value; }
  take(value) { if (this.is(value)) return this.tokens[this.pos++]; return null; }
  expect(value) {
    const result = this.take(value);
    if (!result) fail(`Ожидается «${value}», найдено «${this.current.value}».`, this.current.line);
    return result;
  }
  identifier() {
    const token = this.current;
    if (token.kind !== 'id' || ['begin', 'end', 'then', 'else', 'do', 'to', 'downto', 'var', 'const', 'of'].includes(token.value)) {
      fail('Ожидается имя переменной.', token.line);
    }
    this.pos++; return token;
  }
  type() {
    if (this.take('array')) {
      this.expect('[');
      const low = this.expression(); this.expect('..');
      const high = this.expression(); this.expect(']'); this.expect('of');
      const element = this.identifier();
      if (!TYPES.has(element.value)) fail(`Тип «${element.value}» не поддерживается.`, element.line);
      return {kind: 'array', low, high, element: element.value};
    }
    const name = this.identifier();
    if (!TYPES.has(name.value)) fail(`Тип «${name.value}» не поддерживается.`, name.line);
    return {kind: name.value};
  }
  program() {
    const declarations = [];
    if (this.take('program')) {
      this.identifier();
      if (this.take('(')) { this.identifier(); while(this.take(',')) this.identifier(); this.expect(')'); }
      this.expect(';');
    }
    while (this.is('const') || this.is('var')) {
      const isConst = Boolean(this.take('const'));
      if (!isConst) this.expect('var');
      while (!['var', 'const', 'begin', '<конец программы>'].includes(this.current.value)) {
        const names = [this.identifier()];
        while (this.take(',')) names.push(this.identifier());
        let type = null, initializer = null;
        if (this.take(':')) type = this.type();
        if (isConst) {
          this.expect('=');
          if (type?.kind === 'array' && this.take('(')) {
            const values = [];
            if (!this.is(')')) { values.push(this.expression()); while (this.take(',')) values.push(this.expression()); }
            this.expect(')'); initializer = {type: 'arrayLiteral', values, line: names[0].line};
          } else initializer = this.expression();
        } else if (this.take(':=')) initializer = this.expression();
        if (!isConst && !type && !initializer) fail('Укажи тип переменной после двоеточия.', names[0].line);
        declarations.push({names, type, initializer, isConst, line: names[0].line});
        this.expect(';');
      }
    }
    const body = this.block();
    this.expect('.');
    if (this.current.kind !== 'eof') fail('После end. не должно быть других команд.', this.current.line);
    return {declarations, body};
  }
  block() {
    const begin = this.expect('begin'), statements = [];
    while (!this.is('end')) {
      if (this.current.kind === 'eof') fail('Не найден end для begin.', begin.line);
      statements.push(this.statement());
      if (this.take(';')) { while(this.take(';')) {} }
      else if (!this.is('end')) fail('Между командами нужна точка с запятой «;».', this.current.line);
    }
    this.expect('end');
    return {type: 'block', statements, line: begin.line};
  }
  statement() {
    if (++this.depth > 160) fail('Слишком много вложенных команд.', this.current.line);
    try { return this.statementInner(); } finally { this.depth--; }
  }
  statementInner() {
    const token = this.current, line = token.line;
    if (this.is('begin')) return this.block();
    if (this.take('if')) {
      const condition = this.expression(); this.expect('then');
      const yes = this.statement(), no = this.take('else') ? this.statement() : null;
      return {type: 'if', condition, yes, no, line};
    }
    if (this.take('for')) {
      const declare = Boolean(this.take('var'));
      const name = this.identifier(); this.expect(':='); const from = this.expression();
      let direction;
      if (this.take('to')) direction = 1;
      else if (this.take('downto')) direction = -1;
      else fail('В цикле for ожидается to или downto.', this.current.line);
      const to = this.expression(); this.expect('do'); const body = this.statement();
      return {type: 'for', name: name.value, declare, from, to, direction, body, line};
    }
    if (this.take('while')) {
      const condition = this.expression(); this.expect('do'); const body = this.statement();
      return {type: 'while', condition, body, line};
    }
    if (this.take('repeat')) {
      const statements = [];
      while (!this.is('until')) {
        if (this.current.kind === 'eof') fail('Для repeat не найден until.', line);
        statements.push(this.statement());
        if (!this.take(';') && !this.is('until')) this.expect(';');
      }
      this.expect('until'); const condition = this.expression();
      return {type: 'repeat', statements, condition, line};
    }
    if (this.take('break')) return {type: 'break', line};
    if (this.take('exit')) return {type: 'exit', line};
    if ([';', 'end', 'until'].includes(token.value)) return {type: 'empty', line};
    if (['read', 'readln', 'write', 'writeln', 'inc', 'dec'].includes(token.value)) {
      this.pos++;
      const args = [];
      if (this.take('(')) {
        if (!this.is(')')) {
          do {
            const expr = this.expression();
            let width = null, precision = null;
            if (this.take(':')) { width = this.expression(); if (this.take(':')) precision = this.expression(); }
            args.push({expr, width, precision});
          } while (this.take(','));
        }
        this.expect(')');
      }
      if (['read','readln','inc','dec'].includes(token.value)) {
        for (const [i, arg] of args.entries()) {
          if ((i === 0 || token.value.startsWith('read')) && !['variable', 'index'].includes(arg.expr.type)) fail('Здесь нужно имя переменной или элемент массива.', line);
          if (arg.width) fail('Форматирование поддерживается только для вывода.', line);
        }
      }
      return {type: 'procedure', name: token.value, args, line};
    }
    const target = this.reference(); this.expect(':='); const value = this.expression();
    return {type: 'assign', target, value, line};
  }
  reference() {
    const name = this.identifier();
    let ref = {type: 'variable', name: name.value, line: name.line};
    if (this.take('[')) { const index = this.expression(); this.expect(']'); ref = {type: 'index', object: ref, index, line: name.line}; }
    return ref;
  }
  expression() {
    let left = this.additive();
    if (['=', '<>', '<', '>', '<=', '>='].includes(this.current.value)) {
      const op = this.tokens[this.pos++];
      left = {type: 'binary', op: op.value, left, right: this.additive(), line: op.line};
    }
    return left;
  }
  additive() {
    let left = this.multiplicative();
    while (['+', '-', 'or', 'xor'].includes(this.current.value)) {
      const op = this.tokens[this.pos++];
      left = {type: 'binary', op: op.value, left, right: this.multiplicative(), line: op.line};
    }
    return left;
  }
  multiplicative() {
    let left = this.unary();
    while (['*', '/', 'div', 'mod', 'and'].includes(this.current.value)) {
      const op = this.tokens[this.pos++];
      left = {type: 'binary', op: op.value, left, right: this.unary(), line: op.line};
    }
    return left;
  }
  unary() {
    if (['+', '-', 'not'].includes(this.current.value)) {
      const op = this.tokens[this.pos++];
      return {type: 'unary', op: op.value, value: this.unary(), line: op.line};
    }
    return this.primary();
  }
  primary() {
    const token = this.current;
    if (this.take('(')) { const value = this.expression(); this.expect(')'); return value; }
    if (['number', 'string'].includes(token.kind)) { this.pos++; return {type: 'literal', value: token.value, line: token.line}; }
    if (this.take('true')) return {type: 'literal', value: true, line: token.line};
    if (this.take('false')) return {type: 'literal', value: false, line: token.line};
    if (token.kind !== 'id') fail(`Ожидается число, переменная или выражение; найдено «${token.value}».`, token.line);
    if (this.tokens[this.pos + 1].value === '(') {
      this.pos++; this.expect('('); const args = [];
      if (!this.is(')')) { args.push(this.expression()); while (this.take(',')) args.push(this.expression()); }
      this.expect(')');
      if (!BUILTINS.has(token.value)) fail(`Функция «${token.value}» не поддерживается в тренажёре.`, token.line);
      return {type: 'call', name: token.value, args, line: token.line};
    }
    return this.reference();
  }
}

function defaultValue(type) {
  return ['string', 'char'].includes(type) ? '' : type === 'boolean' ? false : 0;
}

class Runtime {
  constructor(input, options) {
    this.vars = Object.create(null); this.output = ''; this.steps = 0;
    this.maxSteps = Math.max(1, Math.min(Number(options.maxSteps ?? 200000), 1000000));
    this.maxOutput = 50000; this.loopDepth = 0; this.arrayCells = 0;
    this.input = String(input).trim().match(/\S+/g) || []; this.inputPos = 0;
  }
  tick(line) { if (++this.steps > this.maxSteps) fail('Превышен лимит шагов. Проверь границы цикла: программа, возможно, зациклилась.', line); }
  variable(name, line) {
    if (!Object.hasOwn(this.vars, name)) fail(`Переменная «${name}» не объявлена. Добавь её в раздел var.`, line);
    return this.vars[name];
  }
  number(value, line) { if (typeof value !== 'number' || !Number.isFinite(value)) fail('Для этой операции нужно число.', line); return value; }
  integer(value, line) { this.number(value, line); if (!Number.isSafeInteger(value)) fail('Здесь нужно целое число без дробной части.', line); return value; }
  bool(value, line) { if (typeof value !== 'boolean') fail('Условие должно быть логическим: например, a[i] > 0.', line); return value; }
  array(value, line) { if (!value || value.__pascalArray !== true) fail('Квадратные скобки можно использовать только с массивом.', line); return value; }
  convert(value, type, line) {
    if (['integer','longint','int64','byte'].includes(type)) {
      this.integer(value, line);
      if (type === 'byte' && (value < 0 || value > 255)) fail('Значение byte должно быть от 0 до 255.', line);
    } else if (['real','double'].includes(type)) this.number(value, line);
    else if (type === 'boolean') this.bool(value, line);
    else if (['string','char'].includes(type)) { if (typeof value !== 'string') fail('Ожидается текст в одинарных кавычках.', line); if(type === 'char' && value.length !== 1) fail('В переменной char должен быть один символ.', line); }
    return value;
  }
  address(ref) {
    if (ref.type === 'variable') return {variable: this.variable(ref.name, ref.line), name: ref.name};
    if (ref.type !== 'index') fail('Нельзя присвоить значение выражению.', ref.line);
    const variable = this.variable(ref.object.name, ref.line);
    const array = this.array(variable.value, ref.line), index = this.integer(this.eval(ref.index), ref.line);
    if (index < array.low || index > array.high) fail(`Индекс ${index} вне границ массива ${ref.object.name}[${array.low}..${array.high}].`, ref.line);
    return {variable, array, index};
  }
  set(ref, value) {
    const address = this.address(ref);
    if (address.variable.constant) fail('Нельзя изменять константу.', ref.line);
    if (address.array) address.array.values[address.index - address.array.low] = this.convert(value, address.array.element, ref.line);
    else {
      if (address.variable.type === 'array') fail('Присваивай значения отдельным элементам массива: a[i] := ...', ref.line);
      address.variable.value = this.convert(value, address.variable.type, ref.line);
    }
  }
  eval(node) {
    this.tick(node.line);
    switch (node.type) {
      case 'literal': return node.value;
      case 'variable': return this.variable(node.name, node.line).value;
      case 'index': { const a = this.address(node); return a.array.values[a.index - a.array.low]; }
      case 'unary': {
        const value = this.eval(node.value);
        return node.op === 'not' ? !this.bool(value, node.line) : node.op === '-' ? -this.number(value, node.line) : this.number(value, node.line);
      }
      case 'binary': {
        const left = this.eval(node.left);
        if (node.op === 'and' && !this.bool(left, node.line)) return false;
        if (node.op === 'or' && this.bool(left, node.line)) return true;
        const right = this.eval(node.right);
        switch (node.op) {
          case 'and': case 'or': return this.bool(right, node.line);
          case 'xor': return this.bool(left, node.line) !== this.bool(right, node.line);
          case '=': return left === right;
          case '<>': return left !== right;
          case '<': return left < right;
          case '>': return left > right;
          case '<=': return left <= right;
          case '>=': return left >= right;
          case '+': if (typeof left === 'string' && typeof right === 'string') return left + right; break;
        }
        this.number(left, node.line); this.number(right, node.line);
        let result;
        if (['/', 'div', 'mod'].includes(node.op) && right === 0) fail('Деление на ноль. Проверь делитель.', node.line);
        switch(node.op) {
          case '+': result = left + right; break;
          case '-': result = left - right; break;
          case '*': result = left * right; break;
          case '/': result = left / right; break;
          case 'div': this.integer(left,node.line); this.integer(right,node.line); result = Math.trunc(left / right); break;
          case 'mod': this.integer(left,node.line); this.integer(right,node.line); result = left % right; break;
        }
        if (!Number.isFinite(result)) fail('Результат слишком большой или не является числом.', node.line);
        return result;
      }
      case 'call': {
        const args = node.args.map(arg => this.eval(arg));
        const arity = ['min','max'].includes(node.name) ? 2 : 1;
        if (args.length !== arity) fail(`Функция ${node.name} ожидает ${arity} аргумент(а).`, node.line);
        if (['length','low','high'].includes(node.name)) {
          if (node.name === 'length' && typeof args[0] === 'string') return args[0].length;
          const array = this.array(args[0], node.line);
          return node.name === 'low' ? array.low : node.name === 'high' ? array.high : array.values.length;
        }
        if (node.name === 'ord') { if(typeof args[0] === 'boolean') return args[0] ? 1 : 0; if(typeof args[0] === 'string' && args[0].length === 1) return args[0].charCodeAt(0); fail('ord ожидает символ или логическое значение.',node.line); }
        args.forEach(arg => this.number(arg, node.line));
        switch(node.name) {
          case 'abs': return Math.abs(args[0]);
          case 'sqr': return args[0] * args[0];
          case 'sqrt': if(args[0] < 0) fail('Нельзя извлечь квадратный корень из отрицательного числа.', node.line); return Math.sqrt(args[0]);
          case 'trunc': return Math.trunc(args[0]);
          case 'round': return Math.round(args[0]);
          case 'odd': return Math.abs(this.integer(args[0],node.line) % 2) === 1;
          case 'min': return Math.min(...args);
          case 'max': return Math.max(...args);
        }
        break;
      }
    }
    fail('Не удалось вычислить выражение.', node.line);
  }
  declare(declaration) {
    const {names, initializer, isConst, line} = declaration;
    let type = declaration.type;
    for (const name of names) {
      if (Object.hasOwn(this.vars,name.value)) fail(`Имя «${name.value}» уже используется.`, name.line);
      let value;
      if (type?.kind === 'array') {
        const low = this.integer(this.eval(type.low),line), high = this.integer(this.eval(type.high),line);
        if (high < low || high - low + 1 > 100000) fail('Размер массива должен быть от 1 до 100000 элементов.',line);
        this.arrayCells += high-low+1;
        if(this.arrayCells > 200000) fail('Суммарно в учебной программе можно создать до 200000 элементов массивов.',line);
        value = {__pascalArray:true, low, high, element:type.element, values:Array(high-low+1).fill(defaultValue(type.element))};
        if (initializer) {
          if (initializer.type !== 'arrayLiteral') fail('Для массива ожидается список значений в скобках.',line);
          if (initializer.values.length !== value.values.length) fail('Число значений не совпадает с размером массива.',line);
          value.values = initializer.values.map(expr => this.convert(this.eval(expr),type.element,line));
        }
      } else {
        value = initializer ? this.eval(initializer) : defaultValue(type?.kind || 'integer');
        if (!type) type = {kind:typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'real') : typeof value === 'boolean' ? 'boolean' : 'string'};
        value = this.convert(value,type.kind,line);
      }
      this.vars[name.value] = {type:type.kind, value, constant:isConst};
    }
  }
  append(text, line) { this.output += text; if(this.output.length > this.maxOutput) fail('Слишком много вывода. Проверь цикл вывода.',line); }
  execute(node) {
    this.tick(node.line);
    switch(node.type) {
      case 'empty': return null;
      case 'block': for (const statement of node.statements) { const signal = this.execute(statement); if(signal) return signal; } return null;
      case 'assign': this.set(node.target,this.eval(node.value)); return null;
      case 'if': { const branch = this.bool(this.eval(node.condition),node.line) ? node.yes : node.no; return branch ? this.execute(branch) : null; }
      case 'for': {
        const from = this.integer(this.eval(node.from),node.line), to = this.integer(this.eval(node.to),node.line);
        const ref = {type:'variable', name:node.name, line:node.line};
        const previous = node.declare && Object.hasOwn(this.vars,node.name) ? this.vars[node.name] : null;
        if(node.declare) this.vars[node.name] = {type:'integer', value:from, constant:false};
        this.set(ref,from); this.loopDepth++;
        try {
          for(let i=from; node.direction === 1 ? i<=to : i>=to; i+=node.direction) {
            this.tick(node.line); this.set(ref,i);
            const signal = this.execute(node.body);
            if(signal === 'exit') return signal;
            if(signal === 'break') break;
          }
        } finally {
          this.loopDepth--;
          if(node.declare) { if(previous) this.vars[node.name]=previous; else delete this.vars[node.name]; }
        }
        return null;
      }
      case 'while': {
        this.loopDepth++;
        try {
          while(this.bool(this.eval(node.condition),node.line)) {
            this.tick(node.line); const signal=this.execute(node.body);
            if(signal === 'exit') return signal;
            if(signal === 'break') break;
          }
        } finally {this.loopDepth--;}
        return null;
      }
      case 'repeat': {
        this.loopDepth++;
        try {
          do {
            this.tick(node.line); let signal=null;
            for (const statement of node.statements) { signal=this.execute(statement); if(signal) break; }
            if(signal === 'exit') return signal;
            if(signal === 'break') break;
          } while(!this.bool(this.eval(node.condition),node.line));
        } finally {this.loopDepth--;}
        return null;
      }
      case 'break': if(!this.loopDepth) fail('break можно использовать только внутри цикла.',node.line); return 'break';
      case 'exit': return 'exit';
      case 'procedure': {
        if(node.name === 'inc' || node.name === 'dec') {
          if(node.args.length < 1 || node.args.length > 2) fail(`${node.name} ожидает одну переменную и необязательный шаг.`,node.line);
          const value=this.integer(this.eval(node.args[0].expr),node.line), by=node.args[1] ? this.integer(this.eval(node.args[1].expr),node.line) : 1;
          this.set(node.args[0].expr,value+(node.name === 'inc' ? by : -by)); return null;
        }
        if(node.name.startsWith('read')) {
          for(const arg of node.args) {
            const address=this.address(arg.expr), type=address.array ? address.array.element : address.variable.type;
            if(type === 'array') fail('Вводи элементы массива в цикле: read(a[i]).',node.line);
            if(this.inputPos >= this.input.length) fail('Закончились входные данные. Добавь числа в поле «Входные данные».',node.line);
            const token=this.input[this.inputPos++]; let value;
            if(['string','char'].includes(type)) value=token;
            else if(type === 'boolean') {
              if(!/^(true|false)$/i.test(token)) fail(`Ожидается true или false, получено «${token}».`,node.line);
              value=token.toLowerCase() === 'true';
            } else {
              if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) fail(`«${token}» не является числом. Дробную часть отделяй точкой.`,node.line);
              value=Number(token);
            }
            this.set(arg.expr,value);
          }
          return null;
        }
        for(const arg of node.args) {
          const value=this.eval(arg.expr);
          if(value?.__pascalArray) fail('Выводи элементы массива в цикле: write(a[i], \' \').',node.line);
          let text=typeof value === 'boolean' ? (value ? 'True' : 'False') : String(Object.is(value,-0) ? 0 : value);
          if(arg.precision) {
            const precision=this.integer(this.eval(arg.precision),node.line);
            if(precision<0 || precision>15) fail('Для вывода укажи от 0 до 15 знаков после точки.',node.line);
            text=this.number(value,node.line).toFixed(precision);
          }
          if(arg.width) { const width=this.integer(this.eval(arg.width),node.line); if(width<0 || width>1000) fail('Ширина вывода должна быть от 0 до 1000.',node.line); text=text.padStart(width,' '); }
          this.append(text,node.line);
        }
        if(node.name === 'writeln') this.append('\n',node.line);
        return null;
      }
    }
    fail('Неизвестная команда.',node.line);
  }
}

/** Execute the documented teaching subset of Pascal synchronously and deterministically. */
export function runPascal(source, input = '', options = {}) {
  if(typeof source !== 'string' || !source.trim()) fail('Напиши программу перед запуском.');
  if(source.length > 60000) fail('Программа слишком длинная: максимум 60000 символов.');
  let tree;
  try { tree=new Parser(tokenize(source)).program(); }
  catch(error) { if(error instanceof RangeError) fail('Слишком сложное или глубоко вложенное выражение.'); throw error; }
  const runtime=new Runtime(input,options);
  try {
    for(const declaration of tree.declarations) runtime.declare(declaration);
    runtime.execute(tree.body);
  } catch(error) {
    if(error instanceof RangeError) fail('Слишком сложное или глубоко вложенное выражение.');
    throw error;
  }
  const variables=Object.create(null);
  for(const [name, entry] of Object.entries(runtime.vars)) variables[name]=entry.value?.__pascalArray ? {low:entry.value.low, high:entry.value.high, values:[...entry.value.values]} : entry.value;
  return {output:runtime.output, variables, steps:runtime.steps};
}
