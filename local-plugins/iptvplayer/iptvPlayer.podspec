require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'Iptvplayer'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://ozzie.org'
  s.author = 'azzmedia'
  s.source = { :git => 'https://github.com/mohammedaanzi/ozzie-ios', :tag => s.version.to_s }
  s.source_files = 'ios/plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target  = '13.0'
  s.dependency 'Capacitor'
  s.dependency 'MobileVLCKit' # <--- This installs VLC Engine
  s.swift_version = '5.1'
end