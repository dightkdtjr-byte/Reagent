var QRMode = require('./QRMode');

function QR8bitByte(data) {
	this.mode = QRMode.MODE_8BIT_BYTE;
	this.data = String(data == null ? '' : data);
	// QR byte mode는 바이트 길이를 사용해야 합니다. UTF-8로 인코딩해
	// 휴대폰 카메라에서도 한글 텍스트가 깨지지 않도록 합니다.
	this.bytes = Buffer.from(this.data, 'utf8');
}

QR8bitByte.prototype = {

	getLength : function() {
		return this.bytes.length;
	},
	
	write : function(buffer) {
		for (var i = 0; i < this.bytes.length; i++) {
			buffer.put(this.bytes[i], 8);
		}
	}
};

module.exports = QR8bitByte;
