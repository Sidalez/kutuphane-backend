const {execFileSync}=require('node:child_process');
function backendVersion(env=process.env){let commit=env.RENDER_GIT_COMMIT||env.GITHUB_SHA||'';if(!commit)try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim()}catch{}return /^[a-f0-9]{7,40}$/i.test(commit)?commit.slice(0,7):'unknown';}
module.exports={backendVersion};
