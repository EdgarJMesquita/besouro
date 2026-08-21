require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Besouro"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/EdgarJMesquita/besouro.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.private_header_files = "ios/**/*.h"

  # The captured-event database (BesouroDatabase) uses the sqlite3 the system
  # already ships — no vendored engine and nothing for a consumer to add.
  s.library = "sqlite3"
  s.frameworks = "WebKit"

  install_modules_dependencies(s)
end
