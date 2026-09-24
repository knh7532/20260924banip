package com.apptomo.v4.config.security;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.AccessDecisionManager;
import org.springframework.security.access.vote.AffirmativeBased;
import org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.security.SpringSessionBackedSessionRegistry;


// ===== 20260922 추가 시작 : CORS =====
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import java.util.Arrays;
// ===== 20260922 추가 끝 : CORS =====

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

@Configuration
@RequiredArgsConstructor
@EnableWebSecurity
@EnableGlobalMethodSecurity(prePostEnabled = true, securedEnabled = true)
public class SecurityConfig<S extends Session> extends WebSecurityConfigurerAdapter {

    private final Voter voter;
    private final AuthProvider authProvider;
    private final AuthenticationHandler authenticationHandler;
    private final FindByIndexNameSessionRepository<S> sessionRegistry;

    @Value("${apptomo.security.session.max-session}")
    private int maxSession;

    @Bean
    public AccessDecisionManager accessDecisionManager() {
        return new AffirmativeBased(Collections.singletonList(voter));
    }

    @Override
    public void configure(WebSecurity web) throws Exception {
        web.ignoring().antMatchers(
                "/res/**",
                "/resources/**",
                "/favicon.ico",
                "/robots.txt",
                "/prf");
        super.configure(web);
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {

        http.authenticationProvider(authProvider);

        // ===== 20260922 추가 시작 : React(8082) -> Spring CORS 설정 연동 =====
        // WebCorsConfig에 설정한 CORS 정책을 Spring Security에서도 사용하도록 활성화
        http.cors();
        // ===== 20260922 추가 끝 : React(8082) -> Spring CORS 설정 연동 =====

        http.csrf().disable();

        http.formLogin()
                .loginPage("/sign/in")
                .loginProcessingUrl("/sign/in")
                .successHandler(authenticationHandler)
                .failureHandler(authenticationHandler);

        http.logout()
                .logoutUrl("/logout.do")
                .logoutSuccessUrl("/open/view/sign/in")
                // 요청의 프로토콜(HTTPS)를 가져와 Nginx에 전달하기 위해 수정한 코드 .logoutUrl("/logout.do")는 주석처리 후 아래 .logoutSuccessHandler 주석해제
/*                .logoutSuccessHandler((request,response,authentication) ->{
                    String scheme = request.getHeader("X-Forwarded-Proto") != null ? request.getHeader("X-Forwarded-Proto"):request.getScheme();
                    String redirectUrl=scheme+"://"+request.getServerName()+"/open/view/sign/in";
                            response.sendRedirect(redirectUrl);
                })*/
                .invalidateHttpSession(true)
                .deleteCookies("JSESSIONID");

        http.authorizeRequests()
                .accessDecisionManager(accessDecisionManager())
                .antMatchers("/",
                        "/open/**",
                        "/session",
                        "/api/menu/side/*",
                        "/api/file/download/tid/*",
                        "/sign/**",
                        "/license.do",
                        "/error",
                        "/password/find.do",
                        "/api/menu",
                        "/test.do",
                        "/testlogin",
                        "/account/sms/authentication.do",
                        "/code/sms",
                        "/sms/compare",
                        "/terms/service",
                        "/api/v1/sign/**",
                        "/api/v1/migrate",
                        "/terms/get/contents",
                        "/account/org/myData/create.do",
                        "/addMyDataOrganization",
//                        ,
//                        "/account/checkPw",
                        "/OPEN_API_DETAIL**"
//                        "/api/v1/menu/**",
//                        "/open/view/sign/in,",
//                        "/actuator/prometheus",
//                        "/api/approve/waiting/count",
//                        "/res/**",
//                        "/resources/**",
//                        "/favicon.ico",
//                        "/robots.txt",
//                        "/prf"
                )
                .permitAll()
                .anyRequest()
                .authenticated();

        http.headers()
                .httpStrictTransportSecurity()
                .maxAgeInSeconds(0)
                .includeSubDomains(true);

        http.sessionManagement()
                .maximumSessions(maxSession)
                .sessionRegistry(sessionRegistry())
                .expiredUrl("/open/api/sign/in?expired=true");
    }

    @Bean
    public PasswordEncoder passwordEncoder(@Value("${apptomo.security.password.strength}") int strength) {
        String encodingId = "bcrypt";
        Map<String, PasswordEncoder> encoders = new HashMap<>();
        encoders.put(encodingId, new BCryptPasswordEncoder(strength));
        return new DelegatingPasswordEncoder(encodingId, encoders);
    }

    @Bean
    public SpringSessionBackedSessionRegistry<S> sessionRegistry() {
        return new SpringSessionBackedSessionRegistry<>(this.sessionRegistry);
    }

    // ===== 20260922 추가 시작 : React CORS 정책을 Spring Security에 직접 등록 =====
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {

        CorsConfiguration configuration = new CorsConfiguration();

        configuration.setAllowedOrigins(
                Collections.singletonList("http://localhost:8082")
        );

        configuration.setAllowedMethods(
                Arrays.asList(
                        "GET",
                        "POST",
                        "PUT",
                        "PATCH",
                        "DELETE",
                        "OPTIONS"
                )
        );

        configuration.setAllowedHeaders(
                Collections.singletonList("*")
        );

        // fetch credentials: 'include' 사용을 위해 반드시 true
        configuration.setAllowCredentials(true);

        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source =
                new UrlBasedCorsConfigurationSource();

        source.registerCorsConfiguration("/api/**", configuration);

        return source;
    }
// ===== 20260922 추가 끝 : React CORS 정책을 Spring Security에 직접 등록 =====
}
