require 'xcodeproj'

project_path = 'ios/App/App.xcodeproj'
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == 'App' }

# Tell Xcode where the Bridging Header is
target.build_configurations.each do |config|
  config.build_settings['SWIFT_OBJC_BRIDGING_HEADER'] = 'App/App-Bridging-Header.h'
end

project.save
puts "✅ Fixed Xcode Bridging Header settings."