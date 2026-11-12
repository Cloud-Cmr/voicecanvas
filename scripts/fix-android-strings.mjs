import fs from 'node:fs'

const path = 'android/app/src/main/res/values/strings.xml'
const content = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">声绘</string>
    <string name="title_activity_main">声绘</string>
    <string name="package_name">com.voicecanvas.mobile</string>
    <string name="custom_url_scheme">com.voicecanvas.mobile</string>
</resources>
`
fs.writeFileSync(path, content, 'utf8')
console.log('written:', path)
console.log(fs.readFileSync(path, 'utf8'))
