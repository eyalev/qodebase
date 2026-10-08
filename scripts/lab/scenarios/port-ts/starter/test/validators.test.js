import assert from 'node:assert';
import { describe, it } from 'node:test';
import validator from './lib.js';
import test from './testFunctions.js';
import { sanitize } from './sanitize.js';

describe('validator.js', () => {
  it('should validate email addresses', () => {
    test({
      validator: 'isEmail',
      valid: [
        'foo@bar.com',
        'x@x.au',
        'foo@bar.com.au',
        'foo+bar@bar.com',
        'hans.m端ller@test.com',
        'hans@m端ller.com',
        'test|123@m端ller.com',
        'test123+ext@gmail.com',
        'some.name.midd.leNa.me.and.locality+extension@GoogleMail.com',
        '"foobar"@example.com',
        '"  foo  m端ller "@example.com',
        '"foo\\@bar"@example.com',
        `${'a'.repeat(64)}@${'a'.repeat(63)}.com`,
        `${'a'.repeat(64)}@${'a'.repeat(63)}.com`,
        `${'a'.repeat(31)}@gmail.com`,
        'test@gmail.com',
        'test.1@gmail.com',
        'test@1337.com',
      ],
      invalid: [
        'invalidemail@',
        'invalid.com',
        '@invalid.com',
        'foo@bar.com.',
        'foo@_bar.com',
        'somename@ｇｍａｉｌ.com',
        'foo@bar.co.uk.',
        'z@co.c',
        'ｇｍａｉｌｇｍａｉｌｇｍａｉｌｇｍａｉｌｇｍａｉｌ@gmail.com',
        `${'a'.repeat(64)}@${'a'.repeat(251)}.com`,
        `${'a'.repeat(65)}@${'a'.repeat(250)}.com`,
        `${'a'.repeat(64)}@${'a'.repeat(64)}.com`,
        `${'a'.repeat(64)}@${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(63)}.${'a'.repeat(58)}.com`,
        'test1@invalid.co m',
        'test2@invalid.co m',
        'test3@invalid.co m',
        'test4@invalid.co m',
        'test5@invalid.co m',
        'test6@invalid.co m',
        'test7@invalid.co m',
        'test8@invalid.co m',
        'test9@invalid.co m',
        'test10@invalid.co m',
        'test11@invalid.co m',
        'test12@invalid.co　m',
        'test13@invalid.co　m',
        'multiple..dots@stillinvalid.com',
        'test123+invalid! sub_address@gmail.com',
        'gmail...ignores...dots...@gmail.com',
        'ends.with.dot.@gmail.com',
        'multiple..dots@gmail.com',
        'wrong()[]",:;<>@@gmail.com',
        '"wrong()[]",:;<>@@gmail.com',
        'username@domain.com�',
        'username@domain.com©',
        'nbsp test@test.com',
        'nbsp_test@te st.com',
        'nbsp_test@test.co m',
      ],
    });
  });

  it('should validate URLs', () => {
    test({
      validator: 'isURL',
      valid: [
        'foobar.com',
        'www.foobar.com',
        'foobar.com/',
        'valid.au',
        'http://www.foobar.com/',
        'HTTP://WWW.FOOBAR.COM/',
        'https://www.foobar.com/',
        'HTTPS://WWW.FOOBAR.COM/',
        'http://www.foobar.com:23/',
        'http://www.foobar.com:65535/',
        'http://www.foobar.com:5/',
        'https://www.foobar.com/',
        'ftp://www.foobar.com/',
        'http://www.foobar.com/~foobar',
        'http://user:pass@www.foobar.com/',
        'http://user:@www.foobar.com/',
        'http://:pass@www.foobar.com/',
        'http://user@www.foobar.com',
        'http://127.0.0.1/',
        'http://10.0.0.0/',
        'http://189.123.14.13/',
        'http://duckduckgo.com/?q=%2F',
        'http://foobar.com/t$-_.+!*\'(),',
        'http://foobar.com/?foo=bar#baz=qux',
        'http://foobar.com?foo=bar',
        'http://foobar.com#baz=qux',
        'http://www.xn--froschgrn-x9a.net/',
        'http://xn--froschgrn-x9a.com/',
        'http://foo--bar.com',
        'http://høyfjellet.no',
        'http://xn--j1aac5a4g.xn--j1amh',
        'http://xn------eddceddeftq7bvv7c4ke4c.xn--p1ai',
        'http://кулік.укр',
        'test.com?ref=http://test2.com',
        'http://[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]:80/index.html',
        'http://[1080:0:0:0:8:800:200C:417A]/index.html',
        'http://[3ffe:2a00:100:7031::1]',
        'http://[1080::8:800:200C:417A]/foo',
        'http://[::192.9.5.5]/ipng',
        'http://[::FFFF:129.144.52.38]:80/index.html',
        'http://[2010:836B:4179::836B:4179]',
        'http://example.com/example.json#/foo/bar',
        'http://1337.com',
      ],
      invalid: [
        'http://localhost:3000/',
        '//foobar.com',
        'xyz://foobar.com',
        'invalid/',
        'invalid.x',
        'invalid.',
        '.com',
        'http://com/',
        'http://300.0.0.1/',
        'mailto:foo@bar.com',
        'rtmp://foobar.com',
        'http://www.xn--.com/',
        'http://xn--.com/',
        'http://www.foobar.com:0/',
        'http://www.foobar.com:70000/',
        'http://www.foobar.com:99999/',
        'http://www.-foobar.com/',
        'http://www.foobar-.com/',
        'http://foobar/# lol',
        'http://foobar/? lol',
        'http://foobar/ lol/',
        'http://lol @foobar.com/',
        'http://lol:lol @foobar.com/',
        'http://lol:lol:lol@foobar.com/',
        'http://lol: @foobar.com/',
        'http://www.foo_bar.com/',
        'http://www.foobar.com/\t',
        'http://@foobar.com',
        'http://:@foobar.com',
        'http://\n@www.foobar.com/',
        '',
        `http://foobar.com/${new Array(2083).join('f')}`,
        'http://*.foo.com',
        '*.foo.com',
        '!.foo.com',
        'http://example.com.',
        'http://localhost:61500this is an invalid url!!!!',
        '////foobar.com',
        'http:////foobar.com',
        'https://example.com/foo/<script>alert(\'XSS\')</script>/',
      ],
    });
  });

  it('should validate MAC addresses', () => {
    test({
      validator: 'isMACAddress',
      valid: [
        'ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:ab',
        '01:AB:03:04:05:06',
        'A9 C5 D4 9F EB D3',
        '01 02 03 04 05 ab',
        '01-02-03-04-05-ab',
        '0102.0304.05ab',
        'ab:ab:ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:06:07:ab',
        '01:AB:03:04:05:06:07:08',
        'A9 C5 D4 9F EB D3 B6 65',
        '01 02 03 04 05 06 07 ab',
        '01-02-03-04-05-06-07-ab',
        '0102.0304.0506.07ab',
      ],
      invalid: [
        'abc',
        '01:02:03:04:05',
        '01:02:03:04:05:z0',
        '01:02:03:04::ab',
        '1:2:3:4:5:6',
        'AB:CD:EF:GH:01:02',
        'A9C5 D4 9F EB D3',
        '01-02 03:04 05 ab',
        '0102.03:04.05ab',
        '900f/dffs/sdea',
        '01:02:03:04:05:06:07',
        '01:02:03:04:05:06:07:z0',
        '01:02:03:04:05:06::ab',
        '1:2:3:4:5:6:7:8',
        'AB:CD:EF:GH:01:02:03:04',
        'A9C5 D4 9F EB D3 B6 65',
        '01-02 03:04 05 06 07 ab',
        '0102.03:04.0506.07ab',
        '900f/dffs/sdea/54gh',
      ],
    });
    test({
      validator: 'isMACAddress',
      args: [{
        eui: '48',
      }],
      valid: [
        'ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:ab',
        '01:AB:03:04:05:06',
        'A9 C5 D4 9F EB D3',
        '01 02 03 04 05 ab',
        '01-02-03-04-05-ab',
        '0102.0304.05ab',
      ],
      invalid: [
        'ab:ab:ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:06:07:ab',
        '01:AB:03:04:05:06:07:08',
        'A9 C5 D4 9F EB D3 B6 65',
        '01 02 03 04 05 06 07 ab',
        '01-02-03-04-05-06-07-ab',
        '0102.0304.0506.07ab',
      ],
    });
    test({
      validator: 'isMACAddress',
      args: [{
        eui: '64',
      }],
      valid: [
        'ab:ab:ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:06:07:ab',
        '01:AB:03:04:05:06:07:08',
        'A9 C5 D4 9F EB D3 B6 65',
        '01 02 03 04 05 06 07 ab',
        '01-02-03-04-05-06-07-ab',
        '0102.0304.0506.07ab',
      ],
      invalid: [
        'ab:ab:ab:ab:ab:ab',
        'FF:FF:FF:FF:FF:FF',
        '01:02:03:04:05:ab',
        '01:AB:03:04:05:06',
        'A9 C5 D4 9F EB D3',
        '01 02 03 04 05 ab',
        '01-02-03-04-05-ab',
        '0102.0304.05ab',
      ],
    });
  });

  it('should validate IP addresses', () => {
    test({
      validator: 'isIP',
      valid: [
        '127.0.0.1',
        '0.0.0.0',
        '255.255.255.255',
        '1.2.3.4',
        '::1',
        '2001:db8:0000:1:1:1:1:1',
        '2001:db8:3:4::192.0.2.33',
        '2001:41d0:2:a141::1',
        '::ffff:127.0.0.1',
        '::0000',
        '0000::',
        '1::',
        '1111:1:1:1:1:1:1:1',
        'fe80::a6db:30ff:fe98:e946',
        '::',
        '::8',
        '::ffff:127.0.0.1',
        '::ffff:255.255.255.255',
        '::ffff:0:255.255.255.255',
        '::2:3:4:5:6:7:8',
        '::255.255.255.255',
        '0:0:0:0:0:ffff:127.0.0.1',
        '1:2:3:4:5:6:7::',
        '1:2:3:4:5:6::8',
        '1::7:8',
        '1:2:3:4:5::7:8',
        '1:2:3:4:5::8',
        '1::6:7:8',
        '1:2:3:4::6:7:8',
        '1:2:3:4::8',
        '1::5:6:7:8',
        '1:2:3::5:6:7:8',
        '1:2:3::8',
        '1::4:5:6:7:8',
        '1:2::4:5:6:7:8',
        '1:2::8',
        '1::3:4:5:6:7:8',
        '1::8',
        'fe80::7:8%eth0',
        'fe80::7:8%1',
        '64:ff9b::192.0.2.33',
        '0:0:0:0:0:0:10.0.0.1',
      ],
      invalid: [
        'abc',
        '256.0.0.0',
        '0.0.0.256',
        '26.0.0.256',
        '0200.200.200.200',
        '200.0200.200.200',
        '200.200.0200.200',
        '200.200.200.0200',
        '::banana',
        'banana::',
        '::1banana',
        '::1::',
        '1:',
        ':1',
        ':1:1:1::2',
        '1:1:1:1:1:1:1:1:1:1:1:1:1:1:1:1',
        '::11111',
        '11111:1:1:1:1:1:1:1',
        '2001:db8:0000:1:1:1:1::1',
        '0:0:0:0:0:0:ffff:127.0.0.1',
        '0:0:0:0:ffff:127.0.0.1',
      ],
    });
    test({
      validator: 'isIP',
      args: [4],
      valid: [
        '127.0.0.1',
        '0.0.0.0',
        '255.255.255.255',
        '1.2.3.4',
        '255.0.0.1',
        '0.0.1.1',
      ],
      invalid: [
        '::1',
        '2001:db8:0000:1:1:1:1:1',
        '::ffff:127.0.0.1',
        '137.132.10.01',
        '0.256.0.256',
        '255.256.255.256',
      ],
    });
    test({
      validator: 'isIP',
      args: [6],
      valid: [
        '::1',
        '2001:db8:0000:1:1:1:1:1',
        '::ffff:127.0.0.1',
        'fe80::1234%1',
        'ff08::9abc%10',
        'ff08::9abc%interface10',
        'ff02::5678%pvc1.3',
      ],
      invalid: [
        '127.0.0.1',
        '0.0.0.0',
        '255.255.255.255',
        '1.2.3.4',
        '::ffff:287.0.0.1',
        '%',
        'fe80::1234%',
        'fe80::1234%1%3%4',
        'fe80%fe80%',
      ],
    });
    test({
      validator: 'isIP',
      args: [10],
      valid: [],
      invalid: [
        '127.0.0.1',
        '0.0.0.0',
        '255.255.255.255',
        '1.2.3.4',
        '::1',
        '2001:db8:0000:1:1:1:1:1',
      ],
    });
  });

  it('should validate isIPRange', () => {
    test({
      validator: 'isIPRange',
      valid: [
        '127.0.0.1/24',
        '0.0.0.0/0',
        '255.255.255.0/32',
        '::/0',
        '::/128',
        '2001::/128',
        '2001:800::/128',
        '::ffff:127.0.0.1/128',
      ],
      invalid: [
        'abc',
        '127.200.230.1/35',
        '127.200.230.1/-1',
        '1.1.1.1/011',
        '1.1.1/24.1',
        '1.1.1.1/01',
        '1.1.1.1/1.1',
        '1.1.1.1/1.',
        '1.1.1.1/1/1',
        '1.1.1.1',
        '::1',
        '::1/164',
        '2001::/240',
        '2001::/-1',
        '2001::/001',
        '2001::/24.1',
        '2001:db8:0000:1:1:1:1:1',
        '::ffff:127.0.0.1',
      ],
    });
    test({
      validator: 'isIPRange',
      args: [4],
      valid: [
        '127.0.0.1/1',
        '0.0.0.0/1',
        '255.255.255.255/1',
        '1.2.3.4/1',
        '255.0.0.1/1',
        '0.0.1.1/1',
      ],
      invalid: [
        'abc',
        '::1',
        '2001:db8:0000:1:1:1:1:1',
        '::ffff:127.0.0.1',
        '137.132.10.01',
        '0.256.0.256',
        '255.256.255.256',
      ],
    });
    test({
      validator: 'isIPRange',
      args: [6],
      valid: [
        '::1/1',
        '2001:db8:0000:1:1:1:1:1/1',
        '::ffff:127.0.0.1/1',
      ],
      invalid: [
        'abc',
        '127.0.0.1',
        '0.0.0.0',
        '255.255.255.255',
        '1.2.3.4',
        '::ffff:287.0.0.1',
        '::ffff:287.0.0.1/254',
        '%',
        'fe80::1234%',
        'fe80::1234%1%3%4',
        'fe80%fe80%',
      ],
    });
    test({
      validator: 'isIPRange',
      args: [10],
      valid: [],
      invalid: [
        'abc',
        '127.0.0.1/1',
        '0.0.0.0/1',
        '255.255.255.255/1',
        '1.2.3.4/1',
        '::1/1',
        '2001:db8:0000:1:1:1:1:1/1',
      ],
    });
  });

  it('should validate FQDN', () => {
    test({
      validator: 'isFQDN',
      valid: [
        'domain.com',
        'dom.plato',
        'a.domain.co',
        'foo--bar.com',
        'xn--froschgrn-x9a.com',
        'rebecca.blackfriday',
        '1337.com',
      ],
      invalid: [
        'abc',
        '256.0.0.0',
        '_.com',
        '*.some.com',
        's!ome.com',
        'domain.com/',
        '/more.com',
        'domain.com�',
        'domain.co\u00A0m',
        'domain.co\u1680m',
        'domain.co\u2006m',
        'domain.co\u2028m',
        'domain.co\u2029m',
        'domain.co\u202Fm',
        'domain.co\u205Fm',
        'domain.co\u3000m',
        'domain.com\uDC00',
        'domain.co\uEFFFm',
        'domain.co\uFDDAm',
        'domain.co\uFFF4m',
        'domain.com©',
        'example.0',
        '192.168.0.9999',
        '192.168.0',
      ],
    });
  });

  it('should validate alpha strings', () => {
    test({
      validator: 'isAlpha',
      valid: [
        'abc',
        'ABC',
        'FoObar',
      ],
      invalid: [
        'abc1',
        '  foo  ',
        '',
        'ÄBC',
        'FÜübar',
        'Jön',
        'Heiß',
      ],
    });
  });

  it('should validate alphanumeric strings', () => {
    test({
      validator: 'isAlphanumeric',
      valid: [
        'abc123',
        'ABC11',
      ],
      invalid: [
        'abc ',
        'foo!!',
        'ÄBC',
        'FÜübar',
        'Jön',
      ],
    });
  });

  it('should validate numeric strings', () => {
    test({
      validator: 'isNumeric',
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '123.123',
        '+000000',
      ],
      invalid: [
        ' ',
        '',
        '.',
      ],
    });
  });

  it('should validate ports', () => {
    test({
      validator: 'isPort',
      valid: [
        '0',
        '22',
        '80',
        '443',
        '3000',
        '8080',
        '65535',
      ],
      invalid: [
        '',
        '-1',
        '65536',
        '0080',
      ],
    });
  });

  it('should validate decimal numbers', () => {
    test({
      validator: 'isDecimal',
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '-0',
        '0.0000000000001',
      ],
      invalid: [
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '0,0000000000001',
        '0٫01',
        '٫1',
        '1٫0',
        '-٫25',
        '0٫0000000000001',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: 'en-AU' }],
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '-0',
        '0.0000000000001',
      ],
      invalid: [
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '0,0000000000001',
        '0٫01',
        '٫1',
        '1٫0',
        '-٫25',
        '0٫0000000000001',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: ['bg-BG'] }],
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '-0',
        '0,0000000000001',
      ],
      invalid: [
        '0.0000000000001',
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '0٫01',
        '٫1',
        '1٫0',
        '-٫25',
        '0٫0000000000001',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: ['cs-CZ'] }],
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '-0',
        '0,0000000000001',
      ],
      invalid: [
        '0.0000000000001',
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '0٫01',
        '٫1',
        '1٫0',
        '-٫25',
        '0٫0000000000001',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: ['ar-JO'] }],
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0٫01',
        '٫1',
        '1٫0',
        '-٫25',
        '-0',
        '0٫0000000000001',
      ],
      invalid: [
        '0,0000000000001',
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '0.0000000000001',
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: ['ar-EG'] }],
      valid: [
        '0.01',
      ],
      invalid: [
        '0,01',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ locale: ['en-ZM'] }],
      valid: [
        '0,01',
      ],
      invalid: [
        '0.01',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ force_decimal: true }],
      valid: [
        '0.01',
        '.1',
        '1.0',
        '-.25',
        '0.0000000000001',
      ],
      invalid: [
        '-0',
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0,0000000000001',
        '0,01',
        ',1',
        '1,0',
        '-,25',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });

    test({
      validator: 'isDecimal',
      args: [{ decimal_digits: '2,3' }],
      valid: [
        '123',
        '00123',
        '-00123',
        '0',
        '-0',
        '+123',
        '0.01',
        '1.043',
        '.15',
        '-.255',
        '-0',
      ],
      invalid: [
        '0.0000000000001',
        '0.0',
        '.1',
        '1.0',
        '-.2564',
        '0.0',
        '٫1',
        '1٫0',
        '-٫25',
        '0٫0000000000001',
        '....',
        ' ',
        '',
        '-',
        '+',
        '.',
        '0.1a',
        'a',
        '\n',
      ],
    });
  });

  it('should validate lowercase strings', () => {
    test({
      validator: 'isLowercase',
      valid: [
        'abc',
        'abc123',
        'this is lowercase.',
        'tr竪s 端ber',
      ],
      invalid: [
        'fooBar',
        '123A',
      ],
    });
  });

  it('should validate uppercase strings', () => {
    test({
      validator: 'isUppercase',
      valid: [
        'ABC',
        'ABC123',
        'ALL CAPS IS FUN.',
        '   .',
      ],
      invalid: [
        'fooBar',
        '123abc',
      ],
    });
  });

  it('should validate integers', () => {
    test({
      validator: 'isInt',
      valid: [
        '13',
        '123',
        '0',
        '123',
        '-0',
        '+1',
        '01',
        '-01',
        '000',
      ],
      invalid: [
        '100e10',
        '123.123',
        '   ',
        '',
      ],
    });
    test({
      validator: 'isInt',
      args: [{ allow_leading_zeroes: false }],
      valid: [
        '13',
        '123',
        '0',
        '123',
        '-0',
        '+1',
      ],
      invalid: [
        '01',
        '-01',
        '000',
        '100e10',
        '123.123',
        '   ',
        '',
      ],
    });
    test({
      validator: 'isInt',
      args: [{ allow_leading_zeroes: true }],
      valid: [
        '13',
        '123',
        '0',
        '123',
        '-0',
        '+1',
        '01',
        '-01',
        '000',
        '-000',
        '+000',
      ],
      invalid: [
        '100e10',
        '123.123',
        '   ',
        '',
      ],
    });
    test({
      validator: 'isInt',
      args: [{
        min: 10,
      }],
      valid: [
        '15',
        '80',
        '99',
      ],
      invalid: [
        '9',
        '6',
        '3.2',
        'a',
      ],
    });
    test({
      validator: 'isInt',
      args: [{
        min: 10,
        max: 15,
      }],
      valid: [
        '15',
        '11',
        '13',
      ],
      invalid: [
        '9',
        '2',
        '17',
        '3.2',
        '33',
        'a',
      ],
    });
    test({
      validator: 'isInt',
      args: [{
        gt: 10,
        lt: 15,
      }],
      valid: [
        '14',
        '11',
        '13',
      ],
      invalid: [
        '10',
        '15',
        '17',
        '3.2',
        '33',
        'a',
      ],
    });
  });

  it('should validate floats', () => {
    test({
      validator: 'isFloat',
      valid: [
        '123',
        '123.',
        '123.123',
        '-123.123',
        '-0.123',
        '+0.123',
        '0.123',
        '.0',
        '-.123',
        '+.123',
        '01.123',
        '-0.22250738585072011e-307',
      ],
      invalid: [
        '+',
        '-',
        '  ',
        '',
        '.',
        ',',
        'foo',
        '20.foo',
        '2020-01-06T14:31:00.135Z',
      ],
    });

    test({
      validator: 'isFloat',
      args: [{ locale: 'en-AU' }],
      valid: [
        '123',
        '123.',
        '123.123',
        '-123.123',
        '-0.123',
        '+0.123',
        '0.123',
        '.0',
        '-.123',
        '+.123',
        '01.123',
        '-0.22250738585072011e-307',
      ],
      invalid: [
        '123٫123',
        '123,123',
        '  ',
        '',
        '.',
        'foo',
      ],
    });

    test({
      validator: 'isFloat',
      args: [{ locale: 'de-DE' }],
      valid: [
        '123',
        '123,',
        '123,123',
        '-123,123',
        '-0,123',
        '+0,123',
        '0,123',
        ',0',
        '-,123',
        '+,123',
        '01,123',
        '-0,22250738585072011e-307',
      ],
      invalid: [
        '123.123',
        '123٫123',
        '  ',
        '',
        '.',
        'foo',
      ],
    });

    test({
      validator: 'isFloat',
      args: [{ locale: 'ar-JO' }],
      valid: [
        '123',
        '123٫',
        '123٫123',
        '-123٫123',
        '-0٫123',
        '+0٫123',
        '0٫123',
        '٫0',
        '-٫123',
        '+٫123',
        '01٫123',
        '-0٫22250738585072011e-307',
      ],
      invalid: [
        '123,123',
        '123.123',
        '  ',
        '',
        '.',
        'foo',
      ],
    });

    test({
      validator: 'isFloat',
      args: [{
        min: 3.7,
      }],
      valid: [
        '3.888',
        '3.92',
        '4.5',
        '50',
        '3.7',
        '3.71',
      ],
      invalid: [
        '3.6',
        '3.69',
        '3',
        '1.5',
        'a',
      ],
    });
    test({
      validator: 'isFloat',
      args: [{
        min: 0.1,
        max: 1.0,
      }],
      valid: [
        '0.1',
        '1.0',
        '0.15',
        '0.33',
        '0.57',
        '0.7',
      ],
      invalid: [
        '0',
        '0.0',
        'a',
        '1.3',
        '0.05',
        '5',
      ],
    });
    test({
      validator: 'isFloat',
      args: [{
        gt: -5.5,
        lt: 10,
      }],
      valid: [
        '9.9',
        '1.0',
        '0',
        '-1',
        '7',
        '-5.4',
      ],
      invalid: [
        '10',
        '-5.5',
        'a',
        '-20.3',
        '20e3',
        '10.00001',
      ],
    });
    test({
      validator: 'isFloat',
      args: [{
        min: -5.5,
        max: 10,
        gt: -5.5,
        lt: 10,
      }],
      valid: [
        '9.99999',
        '-5.499999',
      ],
      invalid: [
        '10',
        '-5.5',
      ],
    });
    test({
      validator: 'isFloat',
      args: [{
        locale: 'de-DE',
        min: 3.1,
      }],
      valid: [
        '123',
        '123,',
        '123,123',
        '3,1',
        '3,100001',
      ],
      invalid: [
        '3,09',
        '-,123',
        '+,123',
        '01,123',
        '-0,22250738585072011e-307',
        '-123,123',
        '-0,123',
        '+0,123',
        '0,123',
        ',0',
        '123.123',
        '123٫123',
        '  ',
        '',
        '.',
        'foo',
      ],
    });
  });

  it('should validate hexadecimal strings', () => {
    test({
      validator: 'isHexadecimal',
      valid: [
        'deadBEEF',
        'ff0044',
        '0xff0044',
        '0XfF0044',
        '0x0123456789abcDEF',
        '0X0123456789abcDEF',
        '0hfedCBA9876543210',
        '0HfedCBA9876543210',
        '0123456789abcDEF',
      ],
      invalid: [
        'abcdefg',
        '',
        '..',
        '0xa2h',
        '0xa20x',
        '0x0123456789abcDEFq',
        '0hfedCBA9876543210q',
        '01234q56789abcDEF',
      ],
    });
  });

  it('should validate hexadecimal color strings', () => {
    test({
      validator: 'isHexColor',
      valid: [
        '#ff0000ff',
        '#ff0034',
        '#CCCCCC',
        '0f38',
        'fff',
        '#f00',
      ],
      invalid: [
        '#ff',
        'fff0a',
        '#ff12FG',
      ],
    });
  });

  it('should validate md5 strings', () => {
    test({
      validator: 'isMD5',
      valid: [
        'd94f3f016ae679c3008de268209132f2',
        '751adbc511ccbe8edf23d486fa4581cd',
        '88dae00e614d8f24cfd5a8b3f8002e93',
        '0bf1c35032a71a14c2f719e5a14c1e96',
      ],
      invalid: [
        'KYT0bf1c35032a71a14c2f719e5a14c1',
        'q94375dj93458w34',
        '39485729348',
        '%&FHKJFvk',
      ],
    });
  });

  it('should validate hash strings', () => {
    ['md5', 'md4', 'ripemd128', 'tiger128'].forEach((algorithm) => {
      test({
        validator: 'isHash',
        args: [algorithm],
        valid: [
          'd94f3f016ae679c3008de268209132f2',
          '751adbc511ccbe8edf23d486fa4581cd',
          '88dae00e614d8f24cfd5a8b3f8002e93',
          '0bf1c35032a71a14c2f719e5a14c1e96',
          'd94f3F016Ae679C3008de268209132F2',
          '88DAE00e614d8f24cfd5a8b3f8002E93',
        ],
        invalid: [
          'q94375dj93458w34',
          '39485729348',
          '%&FHKJFvk',
          'KYT0bf1c35032a71a14c2f719e5a1',
        ],
      });
    });

    ['crc32', 'crc32b'].forEach((algorithm) => {
      test({
        validator: 'isHash',
        args: [algorithm],
        valid: [
          'd94f3f01',
          '751adbc5',
          '88dae00e',
          '0bf1c350',
          '88DAE00e',
          '751aDBc5',
        ],
        invalid: [
          'KYT0bf1c35032a71a14c2f719e5a14c1',
          'q94375dj93458w34',
          'q943',
          '39485729348',
          '%&FHKJFvk',
        ],
      });
    });

    ['sha1', 'tiger160', 'ripemd160'].forEach((algorithm) => {
      test({
        validator: 'isHash',
        args: [algorithm],
        valid: [
          '3ca25ae354e192b26879f651a51d92aa8a34d8d3',
          'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
          'beb8c3f30da46be179b8df5f5ecb5e4b10508230',
          'efd5d3b190e893ed317f38da2420d63b7ae0d5ed',
          'AAF4c61ddCC5e8a2dabede0f3b482cd9AEA9434D',
          '3ca25AE354e192b26879f651A51d92aa8a34d8D3',
        ],
        invalid: [
          'KYT0bf1c35032a71a14c2f719e5a14c1',
          'KYT0bf1c35032a71a14c2f719e5a14c1dsjkjkjkjkkjk',
          'q94375dj93458w34',
          '39485729348',
          '%&FHKJFvk',
        ],
      });
    });

    test({
      validator: 'isHash',
      args: ['sha256'],
      valid: [
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        '1d996e033d612d9af2b44b70061ee0e868bfd14c2dd90b129e1edeb7953e7985',
        '80f70bfeaed5886e33536bcfa8c05c60afef5a0e48f699a7912d5e399cdcc441',
        '579282cfb65ca1f109b78536effaf621b853c9f7079664a3fbe2b519f435898c',
        '2CF24dba5FB0a30e26E83b2AC5b9E29E1b161e5C1fa7425E73043362938b9824',
        '80F70bFEAed5886e33536bcfa8c05c60aFEF5a0e48f699a7912d5e399cdCC441',
      ],
      invalid: [
        'KYT0bf1c35032a71a14c2f719e5a14c1',
        'KYT0bf1c35032a71a14c2f719e5a14c1dsjkjkjkjkkjk',
        'q94375dj93458w34',
        '39485729348',
        '%&FHKJFvk',
      ],
    });
    test({
      validator: 'isHash',
      args: ['sha384'],
      valid: [
        '3fed1f814d28dc5d63e313f8a601ecc4836d1662a19365cbdcf6870f6b56388850b58043f7ebf2418abb8f39c3a42e31',
        'b330f4e575db6e73500bd3b805db1a84b5a034e5d21f0041d91eec85af1dfcb13e40bb1c4d36a72487e048ac6af74b58',
        'bf547c3fc5841a377eb1519c2890344dbab15c40ae4150b4b34443d2212e5b04aa9d58865bf03d8ae27840fef430b891',
        'fc09a3d11368386530f985dacddd026ae1e44e0e297c805c3429d50744e6237eb4417c20ffca8807b071823af13a3f65',
        '3fed1f814d28dc5d63e313f8A601ecc4836d1662a19365CBDCf6870f6b56388850b58043f7ebf2418abb8f39c3a42e31',
        'b330f4E575db6e73500bd3b805db1a84b5a034e5d21f0041d91EEC85af1dfcb13e40bb1c4d36a72487e048ac6af74b58',
      ],
      invalid: [
        'KYT0bf1c35032a71a14c2f719e5a14c1',
        'KYT0bf1c35032a71a14c2f719e5a14c1dsjkjkjkjkkjk',
        'q94375dj93458w34',
        '39485729348',
        '%&FHKJFvk',
      ],
    });
    test({
      validator: 'isHash',
      args: ['sha512'],
      valid: [
        '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043',
        '83c586381bf5ba94c8d9ba8b6b92beb0997d76c257708742a6c26d1b7cbb9269af92d527419d5b8475f2bb6686d2f92a6649b7f174c1d8306eb335e585ab5049',
        '45bc5fa8cb45ee408c04b6269e9f1e1c17090c5ce26ffeeda2af097735b29953ce547e40ff3ad0d120e5361cc5f9cee35ea91ecd4077f3f589b4d439168f91b9',
        '432ac3d29e4f18c7f604f7c3c96369a6c5c61fc09bf77880548239baffd61636d42ed374f41c261e424d20d98e320e812a6d52865be059745fdb2cb20acff0ab',
        '9B71D224bd62f3785D96d46ad3ea3d73319bFBC2890CAAdae2dff72519673CA72323C3d99ba5c11d7c7ACC6e14b8c5DA0c4663475c2E5c3adef46f73bcDEC043',
        '432AC3d29E4f18c7F604f7c3c96369A6C5c61fC09Bf77880548239baffd61636d42ed374f41c261e424d20d98e320e812a6d52865be059745fdb2cb20acff0ab',
      ],
      invalid: [
        'KYT0bf1c35032a71a14c2f719e5a14c1',
        'KYT0bf1c35032a71a14c2f719e5a14c1dsjkjkjkjkkjk',
        'q94375dj93458w34',
        '39485729348',
        '%&FHKJFvk',
      ],
    });
    test({
      validator: 'isHash',
      args: ['tiger192'],
      valid: [
        '6281a1f098c5e7290927ed09150d43ff3990a0fe1a48267c',
        '56268f7bc269cf1bc83d3ce42e07a85632394737918f4760',
        '46fc0125a148788a3ac1d649566fc04eb84a746f1a6e4fa7',
        '7731ea1621ae99ea3197b94583d034fdbaa4dce31a67404a',
        '6281A1f098c5e7290927ed09150d43ff3990a0fe1a48267C',
        '46FC0125a148788a3AC1d649566fc04eb84A746f1a6E4fa7',
      ],
      invalid: [
        'KYT0bf1c35032a71a14c2f719e5a14c1',
        'KYT0bf1c35032a71a14c2f719e5a14c1dsjkjkjkjkkjk',
        'q94375dj93458w34',
        '39485729348',
        '%&FHKJFvk',
      ],
    });
  });

  it('should validate JWT tokens', () => {
    test({
      validator: 'isJWT',
      valid: [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJsb2dnZWRJbkFzIjoiYWRtaW4iLCJpYXQiOjE0MjI3Nzk2Mzh9.gzSraSYS8EXBxLN_oWnFSRgCzcmJmMjLiuyu5CSpyHI',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJsb3JlbSI6Imlwc3VtIn0.ymiJSsMJXR6tMSr8G9usjQ15_8hKPDv_CArLhxw28MI',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkb2xvciI6InNpdCIsImFtZXQiOlsibG9yZW0iLCJpcHN1bSJdfQ.rRpe04zbWbbJjwM43VnHzAboDzszJtGrNsUxaqQ-GQ8',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqb2huIjp7ImFnZSI6MjUsImhlaWdodCI6MTg1fSwiamFrZSI6eyJhZ2UiOjMwLCJoZWlnaHQiOjI3MH19.YRLPARDmhGMC3BBk_OhtwwK21PIkVCqQe8ncIRPKo-E',
      ],
      invalid: [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJKb2huIERvZSIsImlhdCI6MTUxNjIzOTAyMn0',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJKb2huIERvZSIsImlhdCI6MTYxNjY1Mzg3Mn0.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwiaWF0IjoxNjE2NjUzODcyLCJleHAiOjE2MTY2NTM4ODJ9.a1jLRQkO5TV5y5ERcaPAiM9Xm2gBdRjKrrCpHkGr_8M',
        '$Zs.ewu.su84',
        'ks64$S/9.dy$§kz.3sd73b',
      ],
      error: [
        [],
        {},
        null,
        undefined,
      ],
    });
  });

  it('should validate null strings', () => {
    test({
      validator: 'isEmpty',
      valid: [
        '',
      ],
      invalid: [
        ' ',
        'foo',
        '3',
      ],
    });
    test({
      validator: 'isEmpty',
      args: [{ ignore_whitespace: false }],
      valid: [
        '',
      ],
      invalid: [
        ' ',
        'foo',
        '3',
      ],
    });
    test({
      validator: 'isEmpty',
      args: [{ ignore_whitespace: true }],
      valid: [
        '',
        ' ',
      ],
      invalid: [
        'foo',
        '3',
      ],
    });
  });

  it('should validate strings against an expected value', () => {
    test({
      validator: 'equals', args: ['abc'], valid: ['abc'], invalid: ['Abc', '123'],
    });
  });

  it('should validate strings contain another string', () => {
    test({
      validator: 'contains',
      args: ['foo'],
      valid: ['foo', 'foobar', 'bazfoo'],
      invalid: ['bar', 'fobar'],
    });

    test({
      validator: 'contains',
      args: ['foo', {
        ignoreCase: true,
      }],
      valid: ['Foo', 'FOObar', 'BAZfoo'],
      invalid: ['bar', 'fobar', 'baxoof'],
    });

    test({
      validator: 'contains',
      args: ['foo', {
        minOccurrences: 2,
      }],
      valid: ['foofoofoo', '12foo124foo', 'fofooofoooofoooo', 'foo1foo'],
      invalid: ['foo', 'foobar', 'Fooofoo', 'foofo'],
    });
  });

  it('should validate strings by length (deprecated api)', () => {
    test({
      validator: 'isLength',
      args: [2],
      valid: ['abc', 'de', 'abcd'],
      invalid: ['', 'a'],
    });
    test({
      validator: 'isLength',
      args: [2, 3],
      valid: ['abc', 'de'],
      invalid: ['', 'a', 'abcd'],
    });
    test({
      validator: 'isLength',
      args: [2, 3],
      valid: ['干𩸽', '𠮷野家'],
      invalid: ['', '𠀋', '千竈通り'],
    });
    test({
      validator: 'isLength',
      args: [0, 0],
      valid: [''],
      invalid: ['a', 'ab'],
    });
  });

  it('should validate strings by byte length (deprecated api)', () => {
    test({
      validator: 'isByteLength',
      args: [2],
      valid: ['abc', 'de', 'abcd', 'ｇｍａｉｌ'],
      invalid: ['', 'a'],
    });
    test({
      validator: 'isByteLength',
      args: [2, 3],
      valid: ['abc', 'de', 'ｇ'],
      invalid: ['', 'a', 'abcd', 'ｇｍ'],
    });
    test({
      validator: 'isByteLength',
      args: [0, 0],
      valid: [''],
      invalid: ['ｇ', 'a'],
    });
  });

  it('should validate UUIDs', () => {
    test({
      validator: 'isUUID',
      valid: [
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3',
        'A987FBC9-4BED-4078-8F07-9141BA07C9F3',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3xxx',
        'A987FBC94BED3078CF079141BA07C9F3',
        '934859',
        '987FBC9-4BED-3078-CF07A-9141BA07C9F3',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
      ],
    });
    test({
      validator: 'isUUID',
      args: [undefined],
      valid: [
        'A117FBC9-4BED-3078-CF07-9141BA07C9F3',
        'A117FBC9-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        'A987FBC94BED3078CF079141BA07C9F3',
        'A11AAAAA-1111-1111-AAAG-111111111111',
      ],
    });
    test({
      validator: 'isUUID',
      args: [null],
      valid: [
        'A127FBC9-4BED-3078-CF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        'A127FBC9-4BED-3078-CF07-9141BA07C9F3xxx',
        '912859',
        'A12AAAAA-1111-1111-AAAG-111111111111',
      ],
    });
    test({
      validator: 'isUUID',
      args: [1],
      valid: [
        'E034B584-7D89-11E9-9669-1AECF481A97B',
      ],
      invalid: [
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        'AAAAAAAA-1111-2222-AAAG',
        'AAAAAAAA-1111-2222-AAAG-111111111111',
        'A987FBC9-4BED-4078-8F07-9141BA07C9F3',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [2],
      valid: [
        'A987FBC9-4BED-2078-CF07-9141BA07C9F3',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '11111',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
        'A987FBC9-4BED-4078-8F07-9141BA07C9F3',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [3],
      valid: [
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '934859',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
        'A987FBC9-4BED-4078-8F07-9141BA07C9F3',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [4],
      valid: [
        '713ae7e3-cb32-45f9-adcb-7c4fa86b90c1',
        '625e63f3-58f5-40b7-83a1-a72ad31acffb',
        '57b73598-8764-4ad0-a76a-679bb6640eb1',
        '9c858901-8a57-4791-81fe-4c455b099bc9',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '934859',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [5],
      valid: [
        '987FBC97-4BED-5078-AF07-9141BA07C9F3',
        '987FBC97-4BED-5078-BF07-9141BA07C9F3',
        '987FBC97-4BED-5078-8F07-9141BA07C9F3',
        '987FBC97-4BED-5078-9F07-9141BA07C9F3',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '934859',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
        '9c858901-8a57-4791-81fe-4c455b099bc9',
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [6],
      valid: [],
      invalid: [
        '987FBC97-4BED-1078-AF07-9141BA07C9F3',
        '987FBC97-4BED-2078-AF07-9141BA07C9F3',
        '987FBC97-4BED-3078-AF07-9141BA07C9F3',
        '987FBC97-4BED-4078-AF07-9141BA07C9F3',
        '987FBC97-4BED-5078-AF07-9141BA07C9F3',
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
    });
    test({
      validator: 'isUUID',
      args: [7],
      valid: [
        '018C544A-D384-7000-BB74-3B1738ABE43C',
      ],
      invalid: [
        '',
        'xxxA987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '934859',
        'AAAAAAAA-1111-1111-AAAG-111111111111',
        'A987FBC9-4BED-5078-AF07-9141BA07C9F3',
        'A987FBC9-4BED-3078-CF07-9141BA07C9F3',
        '713ae7e3-cb32-45f9-adcb-7c4fa86b90c1',
        '625e63f3-58f5-40b7-83a1-a72ad31acffb',
        '57b73598-8764-4ad0-a76a-679bb6640eb1',
        '9c858901-8a57-4791-81fe-4c455b099bc9',
      ],
    });
  });

  it('should validate a string that is in another string or array', () => {
    test({
      validator: 'isIn',
      args: ['foobar'],
      valid: ['foo', 'bar', 'foobar', ''],
      invalid: ['foobarbaz', 'barfoo'],
    });
    test({
      validator: 'isIn',
      args: [['foo', 'bar']],
      valid: ['foo', 'bar'],
      invalid: ['foobar', 'barfoo', ''],
    });
    test({
      validator: 'isIn',
      args: [['1', '2', '3']],
      valid: ['1', '2', '3'],
      invalid: ['4', ''],
    });
    test({
      validator: 'isIn',
      args: [['1', '2', '3', { foo: 'bar' }, () => 5, { toString: 'test' }]],
      valid: ['1', '2', '3', ''],
      invalid: ['4'],
    });
    test({ validator: 'isIn', invalid: ['foo', ''] });
  });

  it('should validate JSON', () => {
    test({
      validator: 'isJSON',
      valid: [
        '{ "key": "value" }',
        '{}',
      ],
      invalid: [
        '{ key: "value" }',
        '{ \'key\': \'value\' }',
        'null',
        '1234',
        '"nope"',
      ],
    });
  });

  it('should validate ascii strings', () => {
    test({
      validator: 'isAscii',
      valid: [
        'foobar',
        '0987654321',
        'test@example.com',
        '1234abcDEF',
      ],
      invalid: [
        'ｆｏｏbar',
        'ｘｙｚ０９８',
        '１２３456',
        'ｶﾀｶﾅ',
      ],
    });
  });

  it('should validate Semantic Versioning Specification (SemVer) strings', () => {
    test({
      validator: 'isSemVer',
      valid: [
        '0.0.4',
        '1.2.3',
        '10.20.30',
        '1.1.2-prerelease+meta',
        '1.1.2+meta',
        '1.1.2+meta-valid',
        '1.0.0-alpha',
        '1.0.0-beta',
        '1.0.0-alpha.beta',
        '1.0.0-alpha.beta.1',
        '1.0.0-alpha.1',
        '1.0.0-alpha0.valid',
        '1.0.0-alpha.0valid',
        '1.0.0-alpha-a.b-c-somethinglong+build.1-aef.1-its-okay',
        '1.0.0-rc.1+build.1',
        '2.0.0-rc.1+build.123',
        '1.2.3-beta',
        '10.2.3-DEV-SNAPSHOT',
        '1.2.3-SNAPSHOT-123',
        '1.0.0',
        '2.0.0',
        '1.1.7',
        '2.0.0+build.1848',
        '2.0.1-alpha.1227',
        '1.0.0-alpha+beta',
        '1.2.3----RC-SNAPSHOT.12.9.1--.12+788',
        '1.2.3----R-S.12.9.1--.12+meta',
        '1.2.3----RC-SNAPSHOT.12.9.1--.12',
        '1.0.0+0.build.1-rc.10000aaa-kk-0.1',
        '99999999999999999999999.999999999999999999.99999999999999999',
        '1.0.0-0A.is.legal',
      ],
      invalid: [
        '-invalid+invalid',
        '-invalid.01',
        'alpha',
        'alpha.beta',
        'alpha.beta.1',
        'alpha.1',
        'alpha+beta',
        'alpha_beta',
        'alpha.',
        'alpha..',
        'beta',
        '1.0.0-alpha_beta',
        '-alpha.',
        '1.0.0-alpha..',
        '1.0.0-alpha..1',
        '1.0.0-alpha...1',
        '1.0.0-alpha....1',
        '1.0.0-alpha.....1',
        '1.0.0-alpha......1',
        '1.0.0-alpha.......1',
        '01.1.1',
        '1.01.1',
        '1.1.01',
        '1.2',
        '1.2.3.DEV',
        '1.2-SNAPSHOT',
        '1.2.31.2.3----RC-SNAPSHOT.12.09.1--..12+788',
        '1.2-RC-SNAPSHOT',
        '-1.0.3-gamma+b7718',
        '+justmeta',
        '9.8.7+meta+meta',
        '9.8.7-whatever+meta+meta',
        '99999999999999999999999.999999999999999999.99999999999999999-',
        '---RC-SNAPSHOT.12.09.1--------------------------------..12',
      ],
    });
  });

  it('should validate base64 strings', () => {
    test({
      validator: 'isBase64',
      valid: [
        '',
        'Zg==',
        'Zm8=',
        'Zm9v',
        'Zm9vYg==',
        'Zm9vYmE=',
        'Zm9vYmFy',
        'TG9yZW0gaXBzdW0gZG9sb3Igc2l0IGFtZXQsIGNvbnNlY3RldHVyIGFkaXBpc2NpbmcgZWxpdC4=',
        'Vml2YW11cyBmZXJtZW50dW0gc2VtcGVyIHBvcnRhLg==',
        'U3VzcGVuZGlzc2UgbGVjdHVzIGxlbw==',
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuMPNS1Ufof9EW/M98FNw' +
        'UAKrwflsqVxaxQjBQnHQmiI7Vac40t8x7pIb8gLGV6wL7sBTJiPovJ0V7y7oc0Ye' +
        'rhKh0Rm4skP2z/jHwwZICgGzBvA0rH8xlhUiTvcwDCJ0kc+fh35hNt8srZQM4619' +
        'FTgB66Xmp4EtVyhpQV+t02g6NzK72oZI0vnAvqhpkxLeLiMCyrI416wHm5Tkukhx' +
        'QmcL2a6hNOyu0ixX/x2kSFXApEnVrJ+/IxGyfyw8kf4N2IZpW5nEP847lpfj0SZZ' +
        'Fwrd1mnfnDbYohX2zRptLy2ZUn06Qo9pkG5ntvFEPo9bfZeULtjYzIl6K8gJ2uGZ' +
        'HQIDAQAB',
      ],
      invalid: [
        '12345',
        'Vml2YW11cyBmZXJtZtesting123',
        'Zg=',
        'Z===',
        'Zm=8',
        '=m9vYg==',
        'Zm9vYmFy====',
      ],
    });

    test({
      validator: 'isBase64',
      args: [{ urlSafe: true }],
      valid: [
        '',
        'bGFkaWVzIGFuZCBnZW50bGVtZW4sIHdlIGFyZSBmbG9hdGluZyBpbiBzcGFjZQ',
        '1234',
        'bXVtLW5ldmVyLXByb3Vk',
        'PDw_Pz8-Pg',
        'VGhpcyBpcyBhbiBlbmNvZGVkIHN0cmluZw',
      ],
      invalid: [
        ' AA',
        '\tAA',
        '\rAA',
        '\nAA',
        'This+isa/bad+base64Url==',
        '0K3RgtC+INC30LDQutC+0LTQuNGA0L7QstCw0L3QvdCw0Y8g0YHRgtGA0L7QutCw',
      ],
      error: [
        null,
        undefined,
        {},
        [],
        42,
      ],
    });

    for (let i = 0, str = '', encoded; i < 1000; i++) {
      str += String.fromCharCode(Math.random() * 26 | 97); // eslint-disable-line no-bitwise
      encoded = Buffer.from(str).toString('base64');
      if (!validator.isBase64(encoded)) {
        let msg = format('validator.isBase64() failed with "%s"', encoded);
        throw new Error(msg);
      }
    }
  });

  it('should validate booleans', () => {
    test({
      validator: 'isBoolean',
      valid: [
        'true',
        'false',
        '0',
        '1',
      ],
      invalid: [
        '1.0',
        '0.0',
        'true ',
        'False',
        'True',
        'yes',
      ],
    });
  });

  it('should validate dataURI', () => {
    /* eslint-disable max-len */
    test({
      validator: 'isDataURI',
      valid: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAFVBMVEXk5OTn5+ft7e319fX29vb5+fn///++GUmVAAAALUlEQVQIHWNICnYLZnALTgpmMGYIFWYIZTA2ZFAzTTFlSDFVMwVyQhmAwsYMAKDaBy0axX/iAAAAAElFTkSuQmCC',
        'data:application/media_control+xml;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAFVBMVEXk5OTn5+ft7e319fX29vb5+fn///++GUmVAAAALUlEQVQIHWNICnYLZnALTgpmMGYIFWYIZTA2ZFAzTTFlSDFVMwVyQhmAwsYMAKDaBy0axX/iAAAAAElFTkSuQmCC',
        '   data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAFVBMVEXk5OTn5+ft7e319fX29vb5+fn///++GUmVAAAALUlEQVQIHWNICnYLZnALTgpmMGYIFWYIZTA2ZFAzTTFlSDFVMwVyQhmAwsYMAKDaBy0axX/iAAAAAElFTkSuQmCC   ',
        'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%3E%3Crect%20fill%3D%22%2300B1FF%22%20width%3D%22100%22%20height%3D%22100%22%2F%3E%3C%2Fsvg%3E',
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCBmaWxsPSIjMDBCMUZGIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIvPjwvc3ZnPg==',
        ' data:,Hello%2C%20World!',
        ' data:,Hello World!',
        ' data:text/plain;base64,SGVsbG8sIFdvcmxkIQ%3D%3D',
        ' data:text/html,%3Ch1%3EHello%2C%20World!%3C%2Fh1%3E',
        'data:,A%20brief%20note',
        'data:text/html;charset=US-ASCII,%3Ch1%3EHello!%3C%2Fh1%3E',
        'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,dGVzdC5kb2N4',
      ],
      invalid: [
        'dataxbase64',
        'data:HelloWorld',
        'data:,A%20brief%20invalid%20[note',
        'file:text/plain;base64,SGVsbG8sIFdvcmxkIQ%3D%3D',
        'data:text/html;charset=,%3Ch1%3EHello!%3C%2Fh1%3E',
        'data:text/html;charset,%3Ch1%3EHello!%3C%2Fh1%3E', 'data:base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
        '',
        'http://wikipedia.org',
        'base64',
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4Ug9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
      ],
    });
    /* eslint-enable max-len */
  });

  it('should validate magnetURI', () => {
    /* eslint-disable max-len */
    test({
      validator: 'isMagnetURI',
      valid: [
        'magnet:?xt.1=urn:sha1:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456&xt.2=urn:sha1:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        'magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234&dn=helloword2000&tr=udp://helloworld:1337/announce',
        'magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234&dn=foo',
        'magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234&dn=&tr=&nonexisting=hello world',
        'magnet:?xt=urn:md5:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        'magnet:?xt=urn:tree:tiger:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        'magnet:?xt=urn:ed2k:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?tr=udp://helloworld:1337/announce&xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e',
      ],
      invalid: [
        ':?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magneta:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?xt=uarn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?xt=urn:btihz',
        'magnet::?xt=urn:btih:UHWY2892JNEJ2GTEYOMDNU67E8ICGICYE92JDUGH',
        'magnet:?xt:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'magnet:?xt:urn:nonexisting:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?xt.2=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234',
        'magnet:?xt=urn:ed2k:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789ABCD',
        'magnet:?xt=urn:btmh:1120caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e',
        'magnet:?ttxt=urn:btmh:1220caf1e1c30e81cb361b9ee167c4aa64228a7fa4fa9f6105232b28ad099f3a302e',
      ],
    });
    /* eslint-enable max-len */
  });

  it('should validate LatLong', () => {
    test({
      validator: 'isLatLong',
      valid: [
        '(-17.738223, 85.605469)',
        '(-12.3456789, +12.3456789)',
        '(-60.978437, -0.175781)',
        '(77.719772, -37.529297)',
        '(7.264394, 165.058594)',
        '0.955766, -19.863281',
        '(31.269161,164.355469)',
        '+12.3456789, -12.3456789',
        '-15.379543, -137.285156',
        '(11.770570, -162.949219)',
        '-55.034319, 113.027344',
        '58.025555, 36.738281',
        '55.720923,-28.652344',
        '-90.00000,-180.00000',
        '(-71, -146)',
        '(-71.616864, -146.616864)',
        '-0.55, +0.22',
        '90, 180',
        '+90, -180',
        '-90,+180',
        '90,180',
        '0, 0',
      ],
      invalid: [
        '(020.000000, 010.000000000)',
        '89.9999999989, 360.0000000',
        '90.1000000, 180.000000',
        '+90.000000, -180.00001',
        '090.0000, 0180.0000',
        '126, -158',
        '(-126.400010, -158.400010)',
        '-95, -96',
        '-95.738043, -96.738043',
        '137, -148',
        '(-137.5942, -148.5942)',
        '(-120, -203)',
        '(-119, -196)',
        '+119.821728, -196.821728',
        '(-110, -223)',
        '-110.369532, 223.369532',
        '(-120.969949, +203.969949)',
        '-116, -126',
        '-116.894222, -126.894222',
        '-112, -160',
        '-112.96381, -160.96381',
        '-90., -180.',
        '+90.1, -180.1',
        '(-17.738223, 85.605469',
        '0.955766, -19.863281)',
        '+,-',
        '(,)',
        ',',
        ' ',
      ],
    });

    test({
      validator: 'isLatLong',
      args: [{
        checkDMS: true,
      }],
      valid: [
        '40° 26′ 46″ N, 79° 58′ 56″ W',
        '40° 26′ 46″ S, 79° 58′ 56″ E',
        '90° 0′ 0″ S, 180° 0′ 0″ E',
        '40° 26′ 45.9996″ N, 79° 58′ 55.2″ E',
        '40° 26′ 46″ n, 79° 58′ 56″ w',
        '40°26′46″s, 79°58′56″e',
        '11° 0′ 0.005″ S, 180° 0′ 0″ E',
        '40°26′45.9996″N, 79°58′55.2″E',

      ],
      invalid: [
        '100° 26′ 46″ N, 79° 70′ 56″ W',
        '40° 89′ 46″ S, 79° 58′ 100″ E',
        '40° 26.445′ 45″ N, 79° 58′ 55.2″ E',
        '40° 46″ N, 79° 58′ 56″ W',
      ],
    });
  });

  it('should validate MIME types', () => {
    test({
      validator: 'isMimeType',
      valid: [
        'application/json',
        'application/xhtml+xml',
        'audio/mp4',
        'image/bmp',
        'font/woff2',
        'message/http',
        'model/vnd.gtw',
        'application/media_control+xml',
        'multipart/form-data',
        'multipart/form-data; boundary=something',
        'multipart/form-data; charset=utf-8; boundary=something',
        'multipart/form-data; boundary=something; charset=utf-8',
        'multipart/form-data; boundary=something; charset="utf-8"',
        'multipart/form-data; boundary="something"; charset=utf-8',
        'multipart/form-data; boundary="something"; charset="utf-8"',
        'text/css',
        'text/plain; charset=utf8',
        'Text/HTML;Charset="utf-8"',
        'text/html;charset=UTF-8',
        'Text/html;charset=UTF-8',
        'text/html; charset=us-ascii',
        'text/html; charset=us-ascii (Plain text)',
        'text/html; charset="us-ascii"',
        'video/mp4',
      ],
      invalid: [
        '',
        ' ',
        '/',
        'f/b',
        'application',
        'application\\json',
        'application/json/text',
        'application/json; charset=utf-8',
        'audio/mp4; charset=utf-8',
        'image/bmp; charset=utf-8',
        'font/woff2; charset=utf-8',
        'message/http; charset=utf-8',
        'model/vnd.gtw; charset=utf-8',
        'video/mp4; charset=utf-8',
      ],
    });
  });

  it('should validate slug', () => {
    test({
      validator: 'isSlug',
      valid: [
        'foo',
        'foo-bar',
        'foo_bar',
        'foo-bar-foo',
        'foo-bar_foo',
        'foo-bar_foo*75-b4r-**_foo',
        'foo-bar_foo*75-b4r-**_foo-&&',
      ],
      invalid: [
        'not-----------slug',
        '@#_$@',
        '-not-slug',
        'not-slug-',
        '_not-slug',
        'not-slug_',
        'not slug',
      ],
    });
  });

  it('should sanitize boolean strings', () => {
    sanitize({
      sanitizer: 'toBoolean',
      expect: {
        0: false,
        '': false,
        1: true,
        true: true,
        True: true,
        TRUE: true,
        foobar: true,
        '   ': true,
        false: false,
        False: false,
        FALSE: false,
      },
    });
    sanitize({
      sanitizer: 'toBoolean',
      args: [true], // strict
      expect: {
        0: false,
        '': false,
        1: true,
        true: true,
        True: true,
        TRUE: true,
        foobar: false,
        '   ': false,
        false: false,
        False: false,
        FALSE: false,
      },
    });
  });

  it('should trim whitespace', () => {
    sanitize({
      sanitizer: 'trim',
      expect: {
        '  \r\n\tfoo  \r\n\t   ': 'foo',
        '      \r': '',
      },
    });

    sanitize({
      sanitizer: 'ltrim',
      expect: {
        '  \r\n\tfoo  \r\n\t   ': 'foo  \r\n\t   ',
        '   \t  \n': '',
      },
    });

    sanitize({
      sanitizer: 'rtrim',
      expect: {
        '  \r\n\tfoo  \r\n\t   ': '  \r\n\tfoo',
        ' \r\n  \t': '',
      },
    });
  });

  it('should convert strings to integers', () => {
    sanitize({
      sanitizer: 'toInt',
      expect: {
        3: 3,
        ' 3 ': 3,
        2.4: 2,
        foo: NaN,
      },
    });

    sanitize({
      sanitizer: 'toInt',
      args: [16],
      expect: { ff: 255 },
    });
  });

  it('should convert strings to floats', () => {
    sanitize({
      sanitizer: 'toFloat',
      expect: {
        2: 2.0,
        '2.': 2.0,
        '-2.5': -2.5,
        '.5': 0.5,
        '2020-01-06T14:31:00.135Z': NaN,
        foo: NaN,
      },
    });
  });

  it('should escape HTML', () => {
    sanitize({
      sanitizer: 'escape',
      expect: {
        '<script> alert("xss&fun"); </script>':
            '&lt;script&gt; alert(&quot;xss&amp;fun&quot;); &lt;&#x2F;script&gt;',

        "<script> alert('xss&fun'); </script>":
            '&lt;script&gt; alert(&#x27;xss&amp;fun&#x27;); &lt;&#x2F;script&gt;',

        'Backtick: `':
            'Backtick: &#96;',

        'Backslash: \\':
            'Backslash: &#x5C;',
      },
    });
  });

  it('should unescape HTML', () => {
    sanitize({
      sanitizer: 'unescape',
      expect: {
        '&lt;script&gt; alert(&quot;xss&amp;fun&quot;); &lt;&#x2F;script&gt;':
             '<script> alert("xss&fun"); </script>',

        '&lt;script&gt; alert(&#x27;xss&amp;fun&#x27;); &lt;&#x2F;script&gt;':
            "<script> alert('xss&fun'); </script>",

        'Backtick: &#96;':
            'Backtick: `',

        'Escaped string: &amp;lt;':
            'Escaped string: &lt;',
      },
    });
  });

  it('should remove control characters (<32 and 127)', () => {
    // Check basic functionality
    sanitize({
      sanitizer: 'stripLow',
      expect: {
        'foo\x00': 'foo',
        '\x7Ffoo\x02': 'foo',
        '\x01\x09': '',
        'foo\x0A\x0D': 'foo',
      },
    });
    // Unicode safety
    sanitize({
      sanitizer: 'stripLow',
      expect: {
        perché: 'perch\u00e9',
        '\u20ac': '\u20ac',
        '\u2206\x0A': '\u2206',
        '\ud83d\ude04': '\ud83d\ude04',
      },
    });
    // Preserve newlines
    sanitize({
      sanitizer: 'stripLow',
      args: [true], // keep_new_lines
      expect: {
        'foo\x0A\x0D': 'foo\x0A\x0D',
        '\x03foo\x0A\x0D': 'foo\x0A\x0D',
      },
    });
  });

  it('should sanitize a string based on a whitelist', () => {
    sanitize({
      sanitizer: 'whitelist',
      args: ['abc'],
      expect: {
        abcdef: 'abc',
        aaaaaaaaaabbbbbbbbbb: 'aaaaaaaaaabbbbbbbbbb',
        a1b2c3: 'abc',
        '   ': '',
      },
    });
  });

  it('should sanitize a string based on a blacklist', () => {
    sanitize({
      sanitizer: 'blacklist',
      args: ['abc'],
      expect: {
        abcdef: 'def',
        aaaaaaaaaabbbbbbbbbb: '',
        a1b2c3: '123',
        '   ': '   ',
      },
    });
  });
});
